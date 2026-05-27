import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, verifySuperToken, writeLog } from "../lib/auth.js";
import { notifyMany } from "../lib/notify.js";
import { publishMany } from "../lib/sse.js";

/**
 * SSE 채팅 브로드캐스트.
 * 기존 알림용 스트림(/api/notification/stream) 을 재활용해서 "chat:*" 이벤트를
 * 같은 파이프로 흘려보낸다. 유저당 EventSource 한 개만 유지 → 연결 수 절반.
 *
 * 이벤트 종류:
 *  - chat:message     — 새 메시지 (즉시 전송분만. 예약은 제외)
 *  - chat:update      — 기존 메시지 수정/삭제/고정/리액션 변화
 *  - chat:room        — 방 생성/멤버 변화 등 방 목록 재조회가 필요할 때
 *
 * 수신 대상: 해당 방의 RoomMember 전부 (본인 포함 — 다른 탭/데스크톱 동기화).
 *
 * ⚡ 성능 메모:
 *  1) 호출자는 await 하지 않는다 — DB 조회/SSE write 가 요청 응답을 막지 않도록
 *     fire-and-forget 으로 처리. 실패해도 클라의 증분 폴링이 안전망.
 *  2) 방 멤버는 5초 메모리 캐시로 재사용 (메시지 연속 전송 시 findMany N회 → 1회).
 *     멤버 변경 시 invalidateRoomMembers(roomId) 로 즉시 무효화.
 */
const MEMBER_CACHE_TTL_MS = 5_000;
const memberCache = new Map<string, { at: number; ids: string[] }>();

export function invalidateRoomMembers(roomId: string) {
  memberCache.delete(roomId);
}

async function getRoomMemberIds(roomId: string): Promise<string[]> {
  const hit = memberCache.get(roomId);
  if (hit && Date.now() - hit.at < MEMBER_CACHE_TTL_MS) return hit.ids;
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    select: { userId: true },
  });
  const ids = members.map((m) => m.userId);
  memberCache.set(roomId, { at: Date.now(), ids });
  return ids;
}

function broadcastToRoom(roomId: string, event: "chat:message" | "chat:update" | "chat:room", data: unknown) {
  // 응답 플러시를 절대 막지 않도록 마이크로태스크로 분리.
  queueMicrotask(() => {
    getRoomMemberIds(roomId)
      .then((ids) => publishMany(ids, event, data))
      .catch(() => {});
  });
}

const router = Router();
router.use(requireAuth);

/**
 * 채팅방 목록.
 * 기본: 내가 속한 방만 조회.
 * Super Admin + ?scope=audit: 모든 방 조회 (감사용).
 */
router.get("/rooms", async (req, res) => {
  const u = (req as any).user;
  const scope = String(req.query.scope ?? "");
  const auditMode = scope === "audit";

  if (auditMode) {
    if (!u.superAdmin) return res.status(403).json({ error: "forbidden" });
    if (!verifySuperToken(req, u.id)) {
      return res.status(401).json({
        error: "비밀번호 재확인이 필요합니다",
        code: "SUPER_STEPUP_REQUIRED",
      });
    }
  }

  const where = auditMode ? {} : { members: { some: { userId: u.id } } };
  // take 상한 — audit 모드는 전사 DM 을 훑기 때문에 대규모 조직에서 수만 건이 될 수 있음.
  // 일반 모드도 극단적으로 많은 DM 이 쌓인 계정을 보호.
  const rooms = await prisma.chatRoom.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } } },
      messages: {
        where: { deletedAt: null, scheduledAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    take: auditMode ? 500 : 300,
  });

  if (auditMode) await writeLog(u.id, "CHAT_AUDIT_LIST", undefined, `count=${rooms.length}`);
  res.json({ rooms, auditMode });
});

/**
 * 방 생성. GROUP / DIRECT / TEAM 지원. DIRECT 는 dedupe.
 */
const roomSchema = z.object({
  name: z.string().max(120).optional(),
  type: z.enum(["GROUP", "DIRECT", "TEAM"]).default("GROUP"),
  team: z.string().max(80).optional(),
  // 100명 제한 — 그룹 방이 실무적으로 그 이상 가는 경우가 드물고 DoS 페이로드 차단.
  memberIds: z.array(z.string().max(50)).min(1).max(100),
});

router.post("/rooms", async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;

  if (d.type === "DIRECT") {
    // 중복 ID 가 섞여 올 수 있음 (UI 버그 · 재전송 · 악의 요청).
    // dedupe 후 자기자신 제거 → 정확히 1명이어야 DIRECT 성립.
    // 예전엔 filter 후 length 만 비교했는데, ['friend','friend'] 같은 입력이 들어왔을 때
    // "상대 1명" 가드는 통과하면서 반대편에선 이미 DIRECT 방이 두 개 생기는 경합으로 번짐.
    const others = Array.from(new Set(d.memberIds)).filter((id) => id !== u.id);
    if (others.length !== 1) {
      return res.status(400).json({ error: "1:1 대화는 상대 1명만 선택할 수 있습니다" });
    }
    const other = others[0];
    const existing = await prisma.chatRoom.findFirst({
      where: {
        type: "DIRECT",
        AND: [
          { members: { some: { userId: u.id } } },
          { members: { some: { userId: other } } },
        ],
      },
      include: {
        members: { include: { user: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } } },
        messages: {
          where: { deletedAt: null, scheduledAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (existing) return res.json({ room: existing, reused: true });

    const otherUser = await prisma.user.findUnique({ where: { id: other } });
    if (!otherUser) return res.status(400).json({ error: "상대를 찾을 수 없습니다" });

    const room = await prisma.chatRoom.create({
      data: {
        name: `DM:${u.id}:${other}`,
        type: "DIRECT",
        // DM 도 createdById 박아둠 — 통계/감사 목적 일관성. 삭제는 양쪽 모두 못 함(둘 다 보존 필요).
        createdById: u.id,
        members: { create: [{ userId: u.id }, { userId: other }] },
      },
      include: {
        members: { include: { user: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } } },
        messages: { where: { deletedAt: null, scheduledAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    await writeLog(u.id, "DM_CREATE", room.id, `with:${other}`);
    // 방 생성 직후 — 상대방 클라이언트가 rooms 목록을 다시 받을 수 있도록 신호.
    broadcastToRoom(room.id, "chat:room", { kind: "create", roomId: room.id });
    return res.json({ room });
  }

  if (!d.name) return res.status(400).json({ error: "방 이름이 필요합니다" });
  const memberIds = Array.from(new Set([u.id, ...d.memberIds]));
  const room = await prisma.chatRoom.create({
    data: {
      name: d.name,
      type: d.type,
      // 그룹/팀 방의 생성자 — DELETE /rooms/:id 권한 판정에 사용.
      createdById: u.id,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } } },
      messages: { where: { deletedAt: null, scheduledAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  await writeLog(u.id, "ROOM_CREATE", room.id, `${d.type}:${d.name}`);
  broadcastToRoom(room.id, "chat:room", { kind: "create", roomId: room.id });
  res.json({ room });
});

/**
 * 그룹방(또는 팀방) 삭제.
 *
 * 권한:
 *   - 그룹 생성자(createdById === u.id)
 *   - ADMIN
 *   - 그 외는 403. (DM 은 누구도 삭제 불가 — 보존 정책)
 *
 * 동작:
 *   - 트랜잭션으로 메시지·반응·읽음표시·멤버 cascade 제거 후 방 삭제
 *     (Prisma onDelete: Cascade 가 schema 에 박혀있어 chatRoom.delete 한 번이면 자동 정리)
 *   - 모든 멤버에게 chat:room { kind: "deleted" } 푸시 → 클라가 방 목록에서 즉시 제거
 *
 * 보존:
 *   - 메시지 단순 soft-delete 가 아니라 방 통째로 제거 — 사용자가 "삭제" 의도로 누른 게
 *     맞으니 message row 까지 hard delete. 감사 필요 시 AuditLog 에 ROOM_DELETE + 방
 *     이름/멤버수만 남김.
 */
router.delete("/rooms/:id", async (req, res) => {
  const u = (req as any).user;
  const id = req.params.id;
  const room = await prisma.chatRoom.findUnique({
    where: { id },
    select: { id: true, name: true, type: true, createdById: true, _count: { select: { members: true } } },
  });
  if (!room) return res.status(404).json({ error: "방을 찾을 수 없어요" });
  // DM 은 양쪽 모두 보존 — 한쪽이 지우면 상대도 잃음. 안전상 거부.
  if (room.type === "DIRECT") {
    return res.status(403).json({ error: "1:1 대화는 삭제할 수 없어요" });
  }
  const isCreator = !!room.createdById && room.createdById === u.id;
  const isAdmin = u.role === "ADMIN";
  if (!isCreator && !isAdmin) {
    // 메시지 통일 — "왜 안 되는지" 너무 자세히 알려주지 않음
    // (그룹방 생성자/ADMIN 만 가능하다고 일관되게 안내).
    return res.status(403).json({ error: "그룹 생성자 또는 관리자만 삭제할 수 있어요" });
  }
  // 삭제 직전, 멤버 ID 들을 받아 broadcast 용으로 보관 (cascade 후엔 못 읽음).
  // RoomMember 까지 cascade 되니 broadcastToRoom 은 빈 set 을 받게 됨 → 사전 수집 필수.
  const memberIds = (
    await prisma.roomMember.findMany({ where: { roomId: id }, select: { userId: true } })
  ).map((m) => m.userId);

  // ChatRoom.delete → 스키마의 onDelete: Cascade 가 RoomMember/ChatMessage/MessageReaction
  // 모두 자동 정리. 명시적 트랜잭션 불필요.
  await prisma.chatRoom.delete({ where: { id } });
  await writeLog(
    u.id,
    "ROOM_DELETE",
    id,
    `${room.type}:${room.name} members=${room._count.members} by=${isCreator ? "creator" : "admin"}`,
    req.ip,
  );

  // SSE 푸시 — 클라가 사이드바/탭에서 즉시 방 제거 + 활성 채팅창 닫기.
  // broadcastToRoom 은 roomId 기반인데 방은 이미 삭제됐으니, 멤버 개개인에게 직접 publishMany.
  publishMany(memberIds, "chat:room", { kind: "deleted", roomId: id });

  res.json({ ok: true });
});

/**
 * 메시지 본문 검색 — 내가 속한 방 한정.
 * 같은 방에서 여러 매치가 나올 수 있으므로 각 방의 가장 최근 매치 1건만 반환.
 * 응답: { hits: [{ roomId, room, message }] }
 */
router.get("/search", async (req, res) => {
  const u = (req as any).user;
  // q 가 수 KB 길이로 들어오면 `contains: q` 가 백엔드 B-tree LIKE 스캔을 폭주시킴.
  // 검색창 maxLength(80) 과 맞춰 128자로 하드 캡 — DoS 방어.
  const rawQ = String(req.query.q ?? "").trim();
  const q = rawQ.length > 128 ? rawQ.slice(0, 128) : rawQ;
  if (!q) return res.json({ hits: [] });

  const now = new Date();
  const raw = await prisma.chatMessage.findMany({
    where: {
      deletedAt: null,
      // case-insensitive — Postgres ILIKE. 대소문자 다른 검색어도 매치되게.
      content: { contains: q, mode: "insensitive" },
      OR: [
        { scheduledAt: null },
        { scheduledAt: { lte: now } },
        { senderId: u.id },
      ],
      room: { members: { some: { userId: u.id } } },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    include: {
      sender: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
      room: {
        include: {
          // 검색 결과 카드에 최대 50명까지만 표시 — 대형 그룹방에서 수백 명을 끌어와
          // 응답 크기가 폭발하는 것을 방지. 실제 UI 는 아바타 5개 + "+N" 으로 표시.
          members: { take: 50, include: { user: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } } },
        },
      },
    },
  });

  // 방 중복 제거 — 같은 방이면 가장 최근 매치만
  const seen = new Set<string>();
  const hits: any[] = [];
  for (const m of raw) {
    if (seen.has(m.roomId)) continue;
    seen.add(m.roomId);
    hits.push({
      roomId: m.roomId,
      room: m.room,
      message: {
        id: m.id,
        content: m.content,
        createdAt: m.createdAt,
        sender: m.sender,
      },
    });
  }
  res.json({ hits });
});

/**
 * 메시지 조회. 예약(scheduledAt > now) 은 자기 것만 보이도록.
 * 삭제(deletedAt != null) 는 "삭제된 메시지" 자리표시로 대체.
 */
router.get("/rooms/:id/messages", async (req, res) => {
  const u = (req as any).user;
  const afterId = req.query.after ? String(req.query.after) : undefined;

  // 1 roundtrip: 방 + 모든 멤버의 lastReadAt + (필요시) after 메시지의 createdAt
  // findFirst 를 별도로 돌리던 것을 members 안에서 찾아내도록 병합 → DB 왕복 1회 감소.
  const [room, after] = await Promise.all([
    prisma.chatRoom.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        type: true,
        members: { select: { userId: true, lastReadAt: true } },
      },
    }),
    afterId
      ? prisma.chatMessage.findUnique({
          where: { id: afterId },
          select: { createdAt: true, roomId: true },
        })
      : Promise.resolve(null),
  ]);
  if (!room) return res.status(404).json({ error: "not found" });

  const isMember = room.members.some((m) => m.userId === u.id);
  if (!isMember) {
    if (!u.superAdmin) return res.status(403).json({ error: "forbidden" });
    if (!verifySuperToken(req, u.id)) {
      return res.status(401).json({
        error: "비밀번호 재확인이 필요합니다",
        code: "SUPER_STEPUP_REQUIRED",
      });
    }
    // 감사 로그는 반드시 content 를 내리기 전에 persist — compliance 요건.
    await writeLog(u.id, "CHAT_AUDIT_READ", room.id, `type=${room.type}`);
  }

  const now = new Date();
  const where: any = {
    roomId: room.id,
    OR: [
      { scheduledAt: null },
      { scheduledAt: { lte: now } },
      { senderId: u.id }, // 자기 예약은 자기만 보임
    ],
  };
  // afterId 가 다른 방의 것을 가리키면 무시 — 클라이언트가 방을 막 전환한 상황
  if (after && after.roomId === room.id) {
    where.createdAt = { gt: after.createdAt };
  }

  const raw = await prisma.chatMessage.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: 300,
    include: {
      sender: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
      reactions: { select: { userId: true, emoji: true, user: { select: { name: true } } } },
    },
  });

  // 삭제 메시지 마스킹 (단 본인 + superAdmin 은 원본 볼 수 있음)
  const messages = raw.map((m) => {
    const hide = m.deletedAt && m.senderId !== u.id && !u.superAdmin;
    if (hide) {
      return {
        ...m,
        content: "",
        kind: "TEXT",
        fileUrl: null,
        fileName: null,
        fileType: null,
        fileSize: null,
      };
    }
    return m;
  });

  // readStates 는 room.members 에서 곧바로 뽑아 재사용 — 별도 쿼리 제거.
  const readStates = room.members.map((m) => ({ userId: m.userId, lastReadAt: m.lastReadAt }));

  res.json({
    messages,
    auditMode: !isMember && u.superAdmin,
    roomType: room.type,
    serverTime: now.toISOString(),
    readStates,
  });
});

/**
 * 읽음 처리 — 방을 실제 포커스 중일 때만 호출.
 * 단순히 내 lastReadAt 을 now 로 갱신.
 */
router.post("/rooms/:id/read", async (req, res) => {
  const u = (req as any).user;
  // findUnique 로 복합 unique 인덱스(roomId_userId) 직접 사용 → findFirst 보다 효율적.
  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: req.params.id, userId: u.id } },
  });
  if (!member) return res.json({ ok: true });
  const now = new Date();
  await prisma.roomMember.update({
    where: { id: member.id },
    data: { lastReadAt: now },
  });
  // 상대방(다른 멤버)들에게 "내가 읽었음" 을 즉시 브로드캐스트.
  // 이게 없으면 상대 클라는 30s 폴링 주기가 돌아올 때까지 파란 "1" 뱃지가 남아있음.
  broadcastToRoom(req.params.id, "chat:update", {
    kind: "read",
    roomId: req.params.id,
    userId: u.id,
    lastReadAt: now.toISOString(),
  });
  res.json({ ok: true });
});

/**
 * 메시지 전송 (즉시 또는 예약).
 * 본문, 첨부, scheduledAt 지원.
 */
// fileUrl 은 반드시 우리가 업로드한 /uploads/ 경로로만 허용.
// javascript:, data:, 외부 URL 등을 저장했다가 다른 유저가 클릭하면 XSS/피싱 가능.
const safeFileUrl = z
  .string()
  .regex(/^\/uploads\/[A-Za-z0-9._-]+$/, "허용되지 않는 파일 경로")
  .optional();

const sendSchema = z.object({
  content: z.string().max(8000).optional().default(""),
  kind: z.enum(["TEXT", "IMAGE", "VIDEO", "FILE"]).default("TEXT"),
  fileUrl: safeFileUrl,
  fileName: z.string().max(256).optional(),
  fileType: z.string().max(128).optional(),
  fileSize: z.number().int().nonnegative().max(10 * 1024 * 1024 * 1024).optional(),
  // ISO 8601 문자열. 40자면 밀리초 + 타임존 포함해도 넉넉.
  scheduledAt: z.string().max(40).optional(),
  // 메시지 당 멘션은 50명 상한. 실무 과잉 방지 + 알림 폭탄 차단.
  mentions: z.array(z.string().max(50)).max(50).optional(),
});

router.post("/rooms/:id/messages", async (req, res) => {
  const u = (req as any).user;
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  if (!d.content.trim() && !d.fileUrl) return res.status(400).json({ error: "empty" });

  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: req.params.id, userId: u.id } },
  });
  if (!member) return res.status(403).json({ error: "멤버만 메시지를 보낼 수 있습니다" });

  const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  if (scheduledAt) {
    // Invalid Date 는 getTime() 이 NaN → `NaN <= X` 가 false 라 기존 가드를 통과해
    // Prisma 쓰기에서 500 이 났다. 사전에 400 으로 차단.
    if (Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "예약 시간 형식이 올바르지 않습니다" });
    }
    if (scheduledAt.getTime() <= Date.now() + 5000) {
      return res.status(400).json({ error: "예약 시간은 최소 5초 이후여야 합니다" });
    }
  }

  const mentions = (d.mentions ?? []).filter((id) => id && id !== u.id);

  const msg = await prisma.chatMessage.create({
    data: {
      roomId: req.params.id,
      senderId: u.id,
      content: d.content ?? "",
      kind: d.kind,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
      fileType: d.fileType,
      fileSize: d.fileSize,
      mentions: mentions.length ? mentions.join(",") : null,
      scheduledAt,
    },
    include: {
      sender: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
      room: { select: { id: true, name: true, type: true } },
      reactions: { select: { userId: true, emoji: true, user: { select: { name: true } } } },
    },
  });

  // 보낸 사람은 곧바로 읽은 상태 — 자기 메시지가 안읽음으로 표시되지 않게
  if (!scheduledAt) {
    await prisma.roomMember.update({
      where: { id: member.id },
      data: { lastReadAt: msg.createdAt },
    }).catch(() => {});
  }

  // SSE 즉시 푸시 — 예약 메시지는 실제 발송 시점까지 숨김.
  if (!scheduledAt) {
    broadcastToRoom(req.params.id, "chat:message", { message: msg });
  }

  // 알림 정책
  // - DIRECT: 상대에게 DM 알림
  // - GROUP/TEAM: 멘션된 유저에게만 MENTION 알림 (소음 방지)
  if (!scheduledAt) {
    const preview = (d.content ?? "").trim() || (d.fileName ? `📎 ${d.fileName}` : "(첨부)");
    const roomName = msg.room.type === "DIRECT" ? `${u.name}님과의 1:1` : msg.room.name;

    if (msg.room.type === "DIRECT") {
      const others = await prisma.roomMember.findMany({
        where: { roomId: req.params.id, userId: { not: u.id } },
        select: { userId: true },
      });
      await notifyMany(
        others.map((o) => ({
          userId: o.userId,
          type: "DM" as const,
          title: u.name,
          body: preview.slice(0, 140),
          linkUrl: `/chat?room=${msg.roomId}`,
          actorName: u.name,
        }))
      );
    } else if (mentions.length) {
      await notifyMany(
        mentions.map((uid) => ({
          userId: uid,
          type: "MENTION" as const,
          title: `@${u.name} · ${roomName}`,
          body: preview.slice(0, 140),
          linkUrl: `/chat?room=${msg.roomId}`,
          actorName: u.name,
        }))
      );
    }
  }

  res.json({ message: msg });
});

/* ===== Reactions ===== */
router.post("/messages/:id/reactions", async (req, res) => {
  const u = (req as any).user;
  // emoji 는 짧은 유니코드 시퀀스여야 함 — 길어도 ZWJ 조합 포함 16자 이내.
  // 캡 없으면 DB 용량 공격 / 알림 표시 깨짐.
  const rawEmoji = String(req.body?.emoji ?? "").trim();
  const emoji = rawEmoji.length > 16 ? rawEmoji.slice(0, 16) : rawEmoji;
  if (!emoji) return res.status(400).json({ error: "invalid" });
  const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
  if (!msg) return res.status(404).json({ error: "not found" });
  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: msg.roomId, userId: u.id } },
  });
  if (!member) return res.status(403).json({ error: "forbidden" });

  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: msg.id, userId: u.id, emoji } },
  });
  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.create({
      data: { messageId: msg.id, userId: u.id, emoji },
    });
  }
  // take: 500 — 한 메시지당 최대 리액션 수 상한 (이모지별 중복 허용해도 충분히 넉넉).
  const list = await prisma.messageReaction.findMany({
    where: { messageId: msg.id },
    select: { userId: true, emoji: true, user: { select: { name: true } } },
    take: 500,
  });
  broadcastToRoom(msg.roomId, "chat:update", {
    kind: "reactions",
    messageId: msg.id,
    reactions: list,
  });
  res.json({ reactions: list });
});

/**
 * 메시지 수정. 본인만.
 */
router.patch("/messages/:id", async (req, res) => {
  const u = (req as any).user;
  // sendSchema 의 8000자 상한과 동일하게 PATCH 경로도 강제 — 수정으로 우회 방지.
  const rawContent = req.body?.content !== undefined ? String(req.body.content) : undefined;
  const content = rawContent !== undefined && rawContent.length > 8000 ? rawContent.slice(0, 8000) : rawContent;
  // scheduledAt 문자열이 40자 넘으면 new Date() 가 Invalid Date 를 반환 — 사전에 잘라냄.
  const rawScheduledAt = req.body?.scheduledAt;
  let scheduledAt: Date | null | undefined;
  if (rawScheduledAt === undefined) {
    scheduledAt = undefined;
  } else if (!rawScheduledAt) {
    scheduledAt = null;
  } else {
    const parsed = new Date(String(rawScheduledAt).slice(0, 40));
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "예약 시간 형식이 올바르지 않습니다" });
    }
    scheduledAt = parsed;
  }

  const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
  if (!msg) return res.status(404).json({ error: "not found" });
  if (msg.senderId !== u.id) return res.status(403).json({ error: "본인 메시지만 수정 가능" });
  if (msg.deletedAt) return res.status(400).json({ error: "삭제된 메시지는 수정 불가" });

  const data: any = { editedAt: new Date() };
  if (content !== undefined) data.content = content;
  if (scheduledAt !== undefined) data.scheduledAt = scheduledAt;

  const updated = await prisma.chatMessage.update({
    where: { id: msg.id },
    data,
    include: { sender: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
  });
  broadcastToRoom(msg.roomId, "chat:update", { kind: "edit", message: updated });
  res.json({ message: updated });
});

/**
 * 메시지 고정/해제 토글. 방 멤버 누구나.
 */
router.post("/messages/:id/pin", async (req, res) => {
  const u = (req as any).user;
  const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
  if (!msg) return res.status(404).json({ error: "not found" });
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: msg.roomId, userId: u.id } },
  });
  if (!membership) return res.status(403).json({ error: "방 멤버만 가능" });

  const pin = !msg.pinnedAt;
  const updated = await prisma.chatMessage.update({
    where: { id: msg.id },
    data: {
      pinnedAt: pin ? new Date() : null,
      pinnedById: pin ? u.id : null,
    },
    include: { sender: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
  });
  broadcastToRoom(msg.roomId, "chat:update", { kind: "pin", message: updated });
  res.json({ message: updated });
});

/**
 * 메시지 삭제(소프트). 본인만.
 */
router.delete("/messages/:id", async (req, res) => {
  const u = (req as any).user;
  const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
  if (!msg) return res.status(404).json({ error: "not found" });
  if (msg.senderId !== u.id) return res.status(403).json({ error: "본인 메시지만 삭제 가능" });

  const updated = await prisma.chatMessage.update({
    where: { id: msg.id },
    data: { deletedAt: new Date() },
  });
  broadcastToRoom(msg.roomId, "chat:update", { kind: "delete", messageId: msg.id });
  res.json({ ok: true, message: updated });
});

/**
 * 내 예약 메시지 목록
 */
router.get("/scheduled", async (req, res) => {
  const u = (req as any).user;
  // 예약 메시지는 실무상 많지 않지만, 장기 미체크 시 수천 건 누적 가능 — take 상한.
  const list = await prisma.chatMessage.findMany({
    where: { senderId: u.id, scheduledAt: { gt: new Date() }, deletedAt: null },
    orderBy: { scheduledAt: "asc" },
    include: { room: { select: { id: true, name: true, type: true } } },
    take: 500,
  });
  res.json({ scheduled: list });
});

export default router;
