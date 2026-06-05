import { prisma } from "../lib/db.js";
import { publishMany } from "../lib/sse.js";
import { notifyMany } from "../lib/notify.js";

/**
 * 예약 채팅 메시지 디스패처 — 매 분 tick.
 *
 * 배경: POST /rooms/:id/messages 는 scheduledAt 을 받아 미래 시점 메시지를 저장하지만(숨김),
 * 도래 시점에 실제로 발송(SSE chat:message + 알림)하는 워커가 없어 영영 전달되지 않았다.
 * (현재 클라엔 예약-발송 UI 가 없어 휴면 상태 = 생성되는 예약 메시지가 없음 → 이 워커도 무동작.
 *  추후 예약-발송 UI 를 붙이면 이 워커가 도래분을 발송한다.)
 *
 * 설계:
 *  - 즉시-발송 경로(chat.ts)를 리팩터링하지 않고 발송 로직을 '복제'한다 → 동작 중인 즉시 경로에
 *    영향(회귀)을 주지 않고, 위험을 휴면 기능에만 가둔다. (DRY 보다 안전 우선)
 *  - 멀티 인스턴스(Fargate) 중복 방지: updateMany 가드(scheduledAt not null & lte now)로 한
 *    인스턴스만 claim.count === 1 이 되게 원자적으로 클레임(scheduledAt → null)한 뒤 발송.
 *    (마이그레이션 불필요 — 별도 dispatchedAt 컬럼 없이 scheduledAt 을 null 로 떨궈 '발송됨' 표시.
 *     GET 메시지 조회는 scheduledAt null/lte now 를 보이게 하므로 발송 후 일반 메시지로 정상 노출.)
 */

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
  room: { select: { id: true, name: true, type: true } },
  reactions: { select: { userId: true, emoji: true, user: { select: { name: true } } } },
} as const;

async function dispatchOne(id: string): Promise<void> {
  const msg = await prisma.chatMessage.findUnique({ where: { id }, include: MESSAGE_INCLUDE });
  if (!msg || msg.deletedAt) return;

  const members = await prisma.roomMember.findMany({
    where: { roomId: msg.roomId },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);

  // 발신자는 자기 메시지를 보낸 즉시 읽은 상태로(안읽음 표시 방지) — 즉시 경로와 동일.
  await prisma.roomMember
    .updateMany({ where: { roomId: msg.roomId, userId: msg.senderId }, data: { lastReadAt: msg.createdAt } })
    .catch(() => {});

  // SSE 브로드캐스트(broadcastToRoom 복제) — 방 멤버 전원에게 새 메시지 푸시.
  publishMany(memberIds, "chat:message", { message: msg });

  // 알림 — 즉시 경로(chat.ts)와 동일 정책. DIRECT: 상대에게 DM / GROUP·TEAM: 멘션=MENTION, 그외=DM.
  const preview = (msg.content ?? "").trim() || (msg.fileName ? `📎 ${msg.fileName}` : "(첨부)");
  const roomName = msg.room.type === "DIRECT" ? `${msg.sender.name}님과의 1:1` : msg.room.name;
  const mentions = (msg.mentions ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((x) => x && x !== msg.senderId);
  const others = members.filter((m) => m.userId !== msg.senderId);

  if (msg.room.type === "DIRECT") {
    await notifyMany(
      others.map((o) => ({
        userId: o.userId,
        type: "DM" as const,
        title: msg.sender.name,
        body: preview.slice(0, 140),
        linkUrl: `/chat?room=${msg.roomId}`,
        actorName: msg.sender.name,
        actorAvatarUrl: msg.sender.avatarUrl ?? undefined,
      })),
    );
  } else {
    const mentionSet = new Set(mentions);
    await notifyMany(
      others.map((m) => ({
        userId: m.userId,
        type: (mentionSet.has(m.userId) ? "MENTION" : "DM") as "MENTION" | "DM",
        title: mentionSet.has(m.userId) ? `@${msg.sender.name} · ${roomName}` : roomName,
        body: `${msg.sender.name}: ${preview}`.slice(0, 140),
        linkUrl: `/chat?room=${msg.roomId}`,
        actorName: msg.sender.name,
        actorAvatarUrl: msg.sender.avatarUrl ?? undefined,
      })),
    );
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  // 도래분만 소량씩(과도한 버스트 방지). 다음 tick 이 나머지를 이어 처리.
  const due = await prisma.chatMessage.findMany({
    where: { scheduledAt: { lte: now }, deletedAt: null },
    select: { id: true },
    take: 200,
  });
  for (const { id } of due) {
    // 원자적 클레임 — 다른 인스턴스가 이미 가져갔으면 count 0 → skip.
    const claim = await prisma.chatMessage.updateMany({
      where: { id, scheduledAt: { not: null, lte: now }, deletedAt: null },
      data: { scheduledAt: null },
    });
    if (claim.count !== 1) continue;
    await dispatchOne(id).catch((e) => console.error("[dispatchScheduled] dispatch 실패", id, e));
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** 매 분 예약 메시지 디스패처 시작 (멱등 — 중복 호출 무시). */
export function startScheduledDispatch(): void {
  if (timer) return;
  const run = () => void tick().catch((e) => console.error("[dispatchScheduled] tick 실패", e));
  run();
  timer = setInterval(run, 60_000);
}
