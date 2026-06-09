import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { notifyMany } from "../lib/notify.js";
import { allSameCompanyUsers } from "../lib/tenantValidate.js";
import { getHiddenPositions, excludeHidden } from "../lib/hiddenPositions.js";

const router = Router();
router.use(requireAuth);

/**
 * 회의록 — 노션 스타일 리치 텍스트(JSON) 저장.
 * 공개 범위:
 *   ALL       전사
 *   PROJECT   해당 프로젝트 멤버
 *   SPECIFIC  viewers 에 명시된 유저 + 작성자
 * 작성자는 항상 열람·수정 가능, ADMIN 은 전역 열람.
 */

const VIS = ["ALL", "PROJECT", "SPECIFIC"] as const;

const createSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.any(), // TipTap JSON document
  visibility: z.enum(VIS).default("ALL"),
  // CUID/UUID 길이는 36자 이내. 50자면 여유 있음.
  projectId: z.string().max(50).optional().nullable(),
  // 지정 열람자 최대 200명 — 특정 대상 회의록 자리의 합리적 상한.
  viewerIds: z.array(z.string().max(50)).max(200).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.any().optional(),
  visibility: z.enum(VIS).optional(),
  projectId: z.string().max(50).optional().nullable(),
  viewerIds: z.array(z.string().max(50)).max(200).optional(),
});

// content 는 TipTap JSON 이라 길이가 천차만별. 이미지 다수/긴 표 섞여도 보통 수백 KB
// 안쪽이라 512KB 면 충분. 전역 json limit(2MB) 보다 타이트하게 컷해야 Postgres JSONB
// 파싱/인덱싱 비용이 튀지 않고, 단일 문서 열람 속도도 예측 가능.
const MEETING_CONTENT_MAX = 512_000;
/**
 * TipTap 문서에서 @멘션 노드(type: "mention", attrs.id)의 사용자 ID 집합을 꺼낸다.
 * 중첩 구조라 재귀 — 크기는 본문 상한 512KB 이내라 안전.
 */
function extractMentionIds(doc: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "mention" && n.attrs && typeof n.attrs.id === "string" && n.attrs.id) {
      out.add(n.attrs.id);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out;
}

/** TipTap 문서에서 일반 텍스트만 뽑아 알림 본문 미리보기에 씀. */
function extractPlainText(doc: unknown, limit = 120): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.text === "string") out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out.join(" ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function sizeOfJson(v: unknown): number {
  try {
    return JSON.stringify(v ?? "").length;
  } catch {
    // 순환 참조 등은 어차피 prisma 쪽에서도 터지니 큰 값으로 밀어 버림.
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * 회의록 본문에서 @멘션 자동완성용 — 해당 회의록(또는 설정 중인 공개 범위)
 * 을 열람 가능한 사용자 목록만 돌려준다. 권한 없는 사람을 멘션하면 링크가
 * 깨져 보이므로 서버에서 한 번 필터한다.
 *
 * 쿼리:
 *   meetingId  — 이미 저장된 회의록의 공개 범위 기준 (가장 정확)
 *   또는
 *   visibility=ALL|PROJECT|SPECIFIC
 *   projectId  — PROJECT 일 때
 *   viewerIds  — SPECIFIC 일 때 콤마 구분
 *   q          — (옵션) 이름/이메일/팀/직급 부분 검색
 */
router.get("/mentionable", async (req, res) => {
  const u = (req as any).user;
  const meetingId = typeof req.query.meetingId === "string" ? req.query.meetingId : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

  let visibility: string | undefined;
  let projectId: string | null | undefined;
  let viewerIds: string[] = [];
  let authorId: string | undefined;

  if (meetingId) {
    const m = await prisma.meeting.findFirst({
      where: { id: meetingId, deletedAt: null },
      include: { viewers: { select: { userId: true } } },
    });
    if (!m) return res.status(404).json({ error: "not found" });
    // 열람 권한 없는 사람이 남의 회의록 멘션 목록을 긁어가지 못하게 한 번 걸러둔다.
    const canAccess = await canRead(m, u.id, u.role);
    if (!canAccess) return res.status(403).json({ error: "forbidden" });
    visibility = m.visibility;
    projectId = m.projectId;
    viewerIds = m.viewers.map((v) => v.userId);
    authorId = m.authorId;
  } else {
    visibility = typeof req.query.visibility === "string" ? req.query.visibility : "ALL";
    projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : null;
    const raw = typeof req.query.viewerIds === "string" ? req.query.viewerIds : "";
    viewerIds = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : [];
    // 아직 저장 전이라 작성자 = 본인.
    authorId = u.id;
  }

  // visibility 별로 접근 가능한 유저 ID 집합을 만든다.
  let allowedIds: Set<string> | null = null; // null = 전체 허용
  if (visibility === "ALL") {
    allowedIds = null;
  } else if (visibility === "PROJECT") {
    if (!projectId) {
      allowedIds = new Set<string>(authorId ? [authorId] : []);
    } else {
      const members = await prisma.projectMember.findMany({
        where: { projectId },
        select: { userId: true },
      });
      allowedIds = new Set(members.map((m) => m.userId));
      if (authorId) allowedIds.add(authorId);
    }
  } else if (visibility === "SPECIFIC") {
    allowedIds = new Set(viewerIds);
    if (authorId) allowedIds.add(authorId);
  }

  // 숨김 직급(테스트 계정 등)은 멘션 후보에서 제외(본인은 항상 포함).
  // allowedIds 가 있어도(특정 회의 viewer 픽커) 동일하게 — 회사 정책상 사용자 목록에 안 보임.
  const hiddenP = await getHiddenPositions(u.companyId);
  const users = await prisma.user.findMany({
    where: {
      ...(allowedIds ? { id: { in: Array.from(allowedIds) } } : {}),
      ...excludeHidden(hiddenP, { exceptId: u.id }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      team: true,
      position: true,
      avatarColor: true,

      isDeveloper: true,
      avatarUrl: true,
    },
    take: 500,
    orderBy: { name: "asc" },
  });

  const filtered = q
    ? users.filter(
        (x) =>
          x.name.toLowerCase().includes(q) ||
          x.email.toLowerCase().includes(q) ||
          (x.team ?? "").toLowerCase().includes(q) ||
          (x.position ?? "").toLowerCase().includes(q),
      )
    : users;

  res.json({ users: filtered.slice(0, 50) });
});

/** 내가 읽을 수 있는 회의록 목록. */
router.get("/", async (req, res) => {
  const u = (req as any).user;
  const isAdmin = u.role === "ADMIN";
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;

  // ADMIN 은 전체. 일반 유저는 (ALL) ∪ (PROJECT 내가 멤버인 프로젝트) ∪ (SPECIFIC viewer 포함) ∪ (내가 작성).
  const myProjects = await prisma.projectMember.findMany({
    where: { userId: u.id },
    select: { projectId: true },
  });
  const myProjectIds = myProjects.map((m) => m.projectId);

  const where: any = isAdmin
    ? {}
    : {
        OR: [
          { visibility: "ALL" },
          { visibility: "PROJECT", projectId: { in: myProjectIds.length ? myProjectIds : ["__none__"] } },
          { visibility: "SPECIFIC", viewers: { some: { userId: u.id } } },
          { authorId: u.id },
        ],
      };

  if (projectId) {
    where.projectId = projectId;
  }
  // 휴지통 항목은 일반 목록에서 제외.
  where.deletedAt = null;

  const meetings = await prisma.meeting.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      visibility: true,
      projectId: true,
      authorId: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
      project: { select: { id: true, name: true, color: true } },
    },
  });
  res.json({ meetings });
});

/**
 * 회의록 열람 권한이 있는 유저 ID 만 추려서 반환 — 멘션 알림 대상 필터링용.
 * canRead 를 유저마다 네트워크 호출로 돌리면 멘션 10명에 쿼리 10+개가 나가서
 * 한 번에 확인하도록 별도 구현.
 */
async function filterReadableUsers(meeting: { id: string; authorId: string; visibility: string; projectId: string | null }, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const uniq = Array.from(new Set(userIds));
  // 기본적으로 author 와 ADMIN 은 항상 열람 가능.
  const admins = await prisma.user.findMany({
    where: { id: { in: uniq }, role: "ADMIN", active: true },
    select: { id: true },
  });
  const adminSet = new Set(admins.map((a) => a.id));
  const allowed = new Set<string>();
  for (const id of uniq) {
    if (id === meeting.authorId || adminSet.has(id)) allowed.add(id);
  }
  if (meeting.visibility === "ALL") {
    // active 유저 전원 허용.
    const actives = await prisma.user.findMany({
      where: { id: { in: uniq }, active: true },
      select: { id: true },
    });
    actives.forEach((a) => allowed.add(a.id));
  } else if (meeting.visibility === "PROJECT" && meeting.projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: meeting.projectId, userId: { in: uniq } },
      select: { userId: true },
    });
    members.forEach((m) => allowed.add(m.userId));
  } else if (meeting.visibility === "SPECIFIC") {
    const viewers = await prisma.meetingViewer.findMany({
      where: { meetingId: meeting.id, userId: { in: uniq } },
      select: { userId: true },
    });
    viewers.forEach((v) => allowed.add(v.userId));
  }
  return Array.from(allowed);
}

async function canRead(meeting: any, userId: string, userRole: string) {
  if (userRole === "ADMIN") return true;
  if (meeting.authorId === userId) return true;
  if (meeting.visibility === "ALL") return true;
  if (meeting.visibility === "PROJECT" && meeting.projectId) {
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: meeting.projectId, userId } },
    });
    return !!m;
  }
  if (meeting.visibility === "SPECIFIC") {
    const v = await prisma.meetingViewer.findUnique({
      where: { meetingId_userId: { meetingId: meeting.id, userId } },
    });
    return !!v;
  }
  return false;
}

router.get("/:id", async (req, res) => {
  const u = (req as any).user;
  const meeting = await prisma.meeting.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: {
      author: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
      project: { select: { id: true, name: true, color: true } },
      viewers: {
        include: { user: { select: { id: true, name: true, team: true, position: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
      },
      attachments: {
        orderBy: { createdAt: "asc" },
        include: {
          uploadedBy: { select: { id: true, name: true, avatarColor: true, avatarUrl: true } },
        },
      },
    },
  });
  if (!meeting) return res.status(404).json({ error: "not found" });
  const ok = await canRead(meeting, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  res.json({ meeting });
});

/* =========================== 첨부 (파일·이미지·영상·링크) =========================== */

const ATTACHMENT_KINDS = ["FILE", "IMAGE", "VIDEO", "LINK"] as const;
// 파일 첨부의 url 은 반드시 우리 업로드 경로 — 외부/javascript: 스킴 차단.
const SAFE_UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;
const fileAttachmentSchema = z.object({
  kind: z.enum(["FILE", "IMAGE", "VIDEO"]),
  url: z.string().min(1).max(500).regex(SAFE_UPLOAD_URL, { message: "/uploads/ 경로만 가능합니다" }),
  name: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(0).max(1_000_000_000),
});
// 링크는 사용자가 직접 입력 — 길이 제한 더 빡세게, 프로토콜 검증.
const linkAttachmentSchema = z.object({
  url: z.string().min(1).max(2000).refine(
    (s) => /^https?:\/\//i.test(s),
    { message: "http(s) URL 만 가능합니다" },
  ),
  name: z.string().min(1).max(200),
});

async function loadMeetingForAttachment(id: string) {
  return prisma.meeting.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, authorId: true, visibility: true, projectId: true, title: true },
  });
}

/** 파일/이미지/영상 첨부 — 클라이언트가 /api/upload 로 먼저 올린 메타데이터를 받아 레코드만 생성. */
router.post("/:id/attachment", async (req, res) => {
  const u = (req as any).user;
  const meeting = await loadMeetingForAttachment(req.params.id);
  if (!meeting) return res.status(404).json({ error: "not found" });
  if (!(await canRead(meeting, u.id, u.role))) return res.status(403).json({ error: "forbidden" });
  const parsed = fileAttachmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const att = await prisma.meetingAttachment.create({
    data: {
      meetingId: meeting.id,
      kind: d.kind,
      url: d.url,
      name: d.name,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedById: u.id,
    },
    include: { uploadedBy: { select: { id: true, name: true, avatarColor: true, avatarUrl: true } } },
  });
  await writeLog(u.id, "MEETING_ATTACH_FILE", meeting.id, `${d.kind}:${d.name}`);
  res.json({ attachment: att });
});

/** 링크 첨부 — 외부 URL 과 표시명. 별도 업로드 단계 불필요. */
router.post("/:id/attachment/link", async (req, res) => {
  const u = (req as any).user;
  const meeting = await loadMeetingForAttachment(req.params.id);
  if (!meeting) return res.status(404).json({ error: "not found" });
  if (!(await canRead(meeting, u.id, u.role))) return res.status(403).json({ error: "forbidden" });
  const parsed = linkAttachmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input" });
  const d = parsed.data;
  const att = await prisma.meetingAttachment.create({
    data: {
      meetingId: meeting.id,
      kind: "LINK",
      url: d.url,
      name: d.name,
      uploadedById: u.id,
    },
    include: { uploadedBy: { select: { id: true, name: true, avatarColor: true, avatarUrl: true } } },
  });
  await writeLog(u.id, "MEETING_ATTACH_LINK", meeting.id, d.name);
  res.json({ attachment: att });
});

/** 첨부 삭제 — 업로더 본인 / 회의록 작성자 / ADMIN 만 가능. */
router.delete("/:id/attachment/:attachmentId", async (req, res) => {
  const u = (req as any).user;
  const meeting = await loadMeetingForAttachment(req.params.id);
  if (!meeting) return res.status(404).json({ error: "not found" });
  const att = await prisma.meetingAttachment.findUnique({ where: { id: req.params.attachmentId } });
  if (!att || att.meetingId !== meeting.id) return res.status(404).json({ error: "not found" });
  const canDelete =
    att.uploadedById === u.id ||
    meeting.authorId === u.id ||
    u.role === "ADMIN";
  if (!canDelete) return res.status(403).json({ error: "본인이 올린 첨부 또는 회의록 작성자만 삭제할 수 있어요" });
  await prisma.meetingAttachment.delete({ where: { id: att.id } });
  await writeLog(u.id, "MEETING_ATTACH_DELETE", meeting.id, `${att.kind}:${att.name}`);
  res.json({ ok: true });
});

// 미사용 변수 lint 경고 회피용 — 위 두 스키마가 cover 하는 종류 집합.
void ATTACHMENT_KINDS;

router.post("/", async (req, res) => {
  const u = (req as any).user;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;

  if (sizeOfJson(d.content) > MEETING_CONTENT_MAX) {
    return res.status(413).json({ error: "회의록 본문이 너무 깁니다 (512KB 초과)" });
  }

  // PROJECT 범위면 해당 프로젝트에 내가 속해있거나 ADMIN 이어야 함.
  if (d.visibility === "PROJECT") {
    if (!d.projectId) return res.status(400).json({ error: "projectId required for PROJECT visibility" });
    if (u.role !== "ADMIN") {
      const m = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: d.projectId, userId: u.id } },
      });
      if (!m) return res.status(403).json({ error: "not a project member" });
    }
  }

  // SPECIFIC 열람자(viewerIds)는 반드시 같은 회사 사용자여야 한다 — 안 그러면 타 회사 사용자에게
  // 고아 MeetingViewer 행 + 알림/SSE/APNs 푸시가 주입되는 cross-tenant 결함(자동 스코프는 nested
  // create·publish 를 막지 못함). chat.ts 등 다른 라우트와 동일하게 명시 검증.
  if (d.visibility === "SPECIFIC" && d.viewerIds?.length) {
    if (!(await allSameCompanyUsers(d.viewerIds))) {
      return res.status(400).json({ error: "열람자 중 일부를 찾을 수 없습니다" });
    }
  }

  const meeting = await prisma.meeting.create({
    data: {
      title: d.title,
      content: d.content ?? {},
      visibility: d.visibility,
      projectId: d.visibility === "PROJECT" ? d.projectId ?? null : null,
      authorId: u.id,
      viewers:
        d.visibility === "SPECIFIC" && d.viewerIds?.length
          ? {
              create: Array.from(new Set(d.viewerIds.filter((id) => id !== u.id))).map((userId) => ({
                companyId: u.companyId,
                userId,
              })),
            }
          : undefined,
    },
  });
  await writeLog(u.id, "MEETING_CREATE", meeting.id, d.title);

  // 지정 열람자(SPECIFIC)로 공유된 사람에게 회의록 공유 알림 — 작성자 본인은 제외.
  if (d.visibility === "SPECIFIC" && d.viewerIds?.length) {
    const sharedWith = Array.from(new Set(d.viewerIds.filter((id) => id !== u.id)));
    if (sharedWith.length) {
      await notifyMany(
        sharedWith.map((userId) => ({
          userId,
          type: "SYSTEM" as const,
          title: `${u.name}님이 회의록을 공유했어요`,
          body: d.title,
          linkUrl: `/meetings?id=${meeting.id}`,
          actorName: u.name,
        })),
      );
    }
  }

  // 멘션 알림 — 열람 권한 있는 사람에게만. 본인 제외.
  const mentionIds = Array.from(extractMentionIds(d.content)).filter((id) => id !== u.id);
  if (mentionIds.length) {
    const recipients = await filterReadableUsers(meeting, mentionIds);
    if (recipients.length) {
      const preview = extractPlainText(d.content);
      await notifyMany(
        recipients.map((userId) => ({
          userId,
          type: "MENTION",
          title: `${u.name}님이 회의록에서 언급했어요`,
          body: `${d.title}${preview ? " · " + preview : ""}`.slice(0, 200),
          linkUrl: `/meetings?id=${meeting.id}`,
          actorName: u.name,
        })),
      );
    }
  }
  res.json({ meeting });
});

router.patch("/:id", async (req, res) => {
  const u = (req as any).user;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const existing = await prisma.meeting.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: "not found" });

  // 권한 모델:
  //   - 제목/본문 수정: 열람 권한이 있으면 누구나 가능 (회의록 협업 수정 목적).
  //   - 공개 범위(visibility / projectId / viewerIds) 변경: 작성자 또는 ADMIN 만.
  //     열람자가 SPECIFIC → ALL 로 풀어버리는 사고 방지.
  const isAuthor = existing.authorId === u.id;
  const isAdmin = u.role === "ADMIN";
  const canAccess = await canRead(existing, u.id, u.role);
  if (!canAccess) {
    return res.status(403).json({ error: "forbidden" });
  }
  const d = parsed.data;
  const changesVisibility =
    d.visibility !== undefined || d.projectId !== undefined || d.viewerIds !== undefined;
  if (changesVisibility && !(isAuthor || isAdmin)) {
    return res.status(403).json({ error: "공개 범위는 작성자 또는 관리자만 변경할 수 있어요" });
  }
  if (d.content !== undefined && sizeOfJson(d.content) > MEETING_CONTENT_MAX) {
    return res.status(413).json({ error: "회의록 본문이 너무 깁니다 (512KB 초과)" });
  }

  // 본문/제목이 실제로 바뀌면 변경 전 스냅샷을 MeetingRevision 에 남김. 공개 범위만
  // 조정하는 경우엔 리비전을 찍지 않음 — 히스토리가 의미 있는 건 내용 변화.
  const contentChanged =
    (d.title !== undefined && d.title !== existing.title) ||
    (d.content !== undefined && JSON.stringify(d.content) !== JSON.stringify(existing.content));
  if (contentChanged) {
    try {
      await prisma.meetingRevision.create({
        data: {
          meetingId: existing.id,
          title: existing.title,
          content: existing.content as any,
          editorId: u.id,
        },
      });
    } catch {}
  }

  // visibility=SPECIFIC 으로 바뀌거나 이미 SPECIFIC 인데 viewerIds 를 다시 주면 교체.
  const replaceViewers =
    d.viewerIds !== undefined &&
    ((d.visibility ?? existing.visibility) === "SPECIFIC");

  // 교체될 viewerIds 는 반드시 같은 회사 사용자여야 함(POST 와 동일 — cross-tenant 알림 주입 차단).
  if (replaceViewers && d.viewerIds?.length) {
    if (!(await allSameCompanyUsers(d.viewerIds))) {
      return res.status(400).json({ error: "열람자 중 일부를 찾을 수 없습니다" });
    }
  }

  // 교체 전 기존 열람자 스냅샷 — 트랜잭션 후 새로 추가된 사람에게만 공유 알림을 보내기 위함.
  const prevViewerIds = replaceViewers
    ? new Set(
        (
          await prisma.meetingViewer.findMany({
            where: { meetingId: existing.id },
            select: { userId: true },
          })
        ).map((v) => v.userId),
      )
    : new Set<string>();

  const updated = await prisma.$transaction(async (tx) => {
    if (replaceViewers) {
      await tx.meetingViewer.deleteMany({ where: { meetingId: existing.id } });
      if (d.viewerIds && d.viewerIds.length) {
        await tx.meetingViewer.createMany({
          data: Array.from(new Set(d.viewerIds.filter((id) => id !== existing.authorId))).map((userId) => ({
            meetingId: existing.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    }
    return tx.meeting.update({
      where: { id: existing.id },
      data: {
        title: d.title,
        content: d.content,
        visibility: d.visibility,
        projectId:
          d.visibility !== undefined
            ? d.visibility === "PROJECT"
              ? d.projectId ?? existing.projectId
              : null
            : d.projectId ?? undefined,
      },
    });
  }, {
    // 명시적 timeout — viewer 가 수십명일 때 deleteMany + createMany 가 길어질 수 있어 8초.
    timeout: 8_000,
  });
  await writeLog(u.id, "MEETING_UPDATE", updated.id);

  // 열람자가 교체된 경우, 새로 추가된 사람에게만 회의록 공유 알림 — 작성자/본인 제외.
  if (replaceViewers && d.viewerIds) {
    const newlyShared = Array.from(
      new Set(d.viewerIds.filter((id) => id !== existing.authorId && id !== u.id)),
    ).filter((id) => !prevViewerIds.has(id));
    if (newlyShared.length) {
      await notifyMany(
        newlyShared.map((userId) => ({
          userId,
          type: "SYSTEM" as const,
          title: `${u.name}님이 회의록을 공유했어요`,
          body: updated.title,
          linkUrl: `/meetings?id=${updated.id}`,
          actorName: u.name,
        })),
      );
    }
  }

  // 본문이 바뀌었고 새로 추가된 멘션이 있다면 그 사람들에게만 알림. 이미 언급됐던 사람은 스킵.
  if (d.content !== undefined) {
    const before = extractMentionIds(existing.content);
    const after = extractMentionIds(d.content);
    const added = Array.from(after).filter((id) => !before.has(id) && id !== u.id);
    if (added.length) {
      const recipients = await filterReadableUsers(updated, added);
      if (recipients.length) {
        const preview = extractPlainText(d.content);
        await notifyMany(
          recipients.map((userId) => ({
            userId,
            type: "MENTION",
            title: `${u.name}님이 회의록에서 언급했어요`,
            body: `${updated.title}${preview ? " · " + preview : ""}`.slice(0, 200),
            linkUrl: `/meetings?id=${updated.id}`,
            actorName: u.name,
          })),
        );
      }
    }
  }
  res.json({ meeting: updated });
});

/**
 * 회의록 버전 히스토리. 읽기 권한만 있으면 누구나 열람 가능.
 * 복구는 수정 권한(= 읽기 권한) 을 가진 사람 누구나 가능하도록 수정 규칙과 맞춤.
 */
router.get("/:id/revisions", async (req, res) => {
  const u = (req as any).user;
  const existing = await prisma.meeting.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (!(await canRead(existing, u.id, u.role))) return res.status(403).json({ error: "forbidden" });
  const rows = await prisma.meetingRevision.findMany({
    where: { meetingId: existing.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { editor: { select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
  });
  res.json({ revisions: rows });
});

router.post("/:id/revisions/:revId/restore", async (req, res) => {
  const u = (req as any).user;
  const existing = await prisma.meeting.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (!(await canRead(existing, u.id, u.role))) return res.status(403).json({ error: "forbidden" });
  const rev = await prisma.meetingRevision.findUnique({ where: { id: req.params.revId } });
  if (!rev || rev.meetingId !== existing.id) return res.status(404).json({ error: "revision not found" });
  await prisma.meetingRevision.create({
    data: { meetingId: existing.id, title: existing.title, content: existing.content as any, editorId: u.id },
  });
  const updated = await prisma.meeting.update({
    where: { id: existing.id },
    data: { title: rev.title, content: rev.content as any },
  });
  await writeLog(u.id, "MEETING_REVISION_RESTORE", existing.id, rev.id);
  res.json({ meeting: updated });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const existing = await prisma.meeting.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.authorId !== u.id && u.role !== "ADMIN") {
    return res.status(403).json({ error: "forbidden" });
  }
  // 소프트 삭제 — 휴지통에서 30일 이내 복구 가능. 영구 삭제는 admin trash 페이지.
  await prisma.meeting.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), deletedById: u.id },
  });
  await writeLog(u.id, "MEETING_DELETE", existing.id);
  res.json({ ok: true });
});

export default router;
