import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { generateWebhookToken } from "./webhook.js";

const router = Router();
router.use(requireAuth);

/**
 * 내가 참여중인 프로젝트 목록.
 * - 사이드바 "팀" 섹션에서 쓰기 위해 가볍게 반환.
 * - ADMIN 은 전체 프로젝트를 볼 수 있게 옵션(all=1) 지원.
 */
router.get("/", async (req, res) => {
  const u = (req as any).user;
  const all = req.query.all === "1" && u.role === "ADMIN";
  const where = all ? {} : { members: { some: { userId: u.id } } };
  const list = await prisma.project.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      _count: { select: { members: true } },
    },
  });
  res.json({ projects: list });
});

router.get("/:id", async (req, res) => {
  const u = (req as any).user;
  const p = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, team: true, position: true, avatarColor: true, isDeveloper: true, avatarUrl: true } } },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!p) return res.status(404).json({ error: "not found" });
  // 멤버가 아니면 조회 불가 (ADMIN 제외)
  const isMember = p.members.some((m) => m.userId === u.id);
  if (!isMember && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  res.json({ project: p });
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  color: z.string().max(16).optional(),
  // 초기 멤버 최대 200명 — 그 이상은 대시보드 성능이 무너짐.
  memberIds: z.array(z.string().max(50)).max(200).optional(),
});

router.post("/", async (req, res) => {
  const u = (req as any).user;
  // 프로젝트 생성은 ADMIN 만 — 일반 유저는 멤버로 초대받아 참여한다.
  if (u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  // 생성자는 OWNER 로 자동 포함. 중복 제거.
  const memberSet = new Set<string>([u.id, ...(d.memberIds ?? [])]);
  const project = await prisma.project.create({
    data: {
      name: d.name,
      description: d.description ?? null,
      color: d.color ?? "#3B5CF0",
      createdById: u.id,
      members: {
        create: Array.from(memberSet).map((uid) => ({
          companyId: u.companyId,
          userId: uid,
          role: uid === u.id ? "OWNER" : "MEMBER",
        })),
      },
    },
    include: { _count: { select: { members: true } } },
  });
  await writeLog(u.id, "PROJECT_CREATE", project.id, d.name);
  res.json({ project });
});

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  color: z.string().max(16).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

router.patch("/:id", async (req, res) => {
  const u = (req as any).user;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: req.params.id, userId: u.id } },
  });
  if (!m && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  if (m && m.role === "MEMBER" && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  const p = await prisma.project.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  await writeLog(u.id, "PROJECT_UPDATE", p.id);
  res.json({ project: p });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: req.params.id, userId: u.id } },
  });
  if (!m && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  if (m && m.role !== "OWNER" && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  await prisma.project.delete({ where: { id: req.params.id } });
  await writeLog(u.id, "PROJECT_DELETE", req.params.id);
  res.json({ ok: true });
});

/* ---------------- 프로젝트 일정 ---------------- */

async function assertProjectMember(projectId: string, userId: string, adminRole: string) {
  if (adminRole === "ADMIN") return true;
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  return !!m;
}

/** 범위 내 프로젝트 이벤트 조회. from/to 는 ISO. */
router.get("/:id/events", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  // Invalid Date 는 Prisma 500 을 유발 — 파싱 실패 시 해당 경계만 무시.
  const parseOrNull = (s: unknown) => {
    if (!s) return null;
    const d = new Date(String(s));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = parseOrNull(req.query.from);
  const to = parseOrNull(req.query.to);
  const where: any = { projectId: req.params.id };
  if (from && to) {
    // 구간 겹침: startAt <= to AND endAt >= from
    where.AND = [{ startAt: { lte: to } }, { endAt: { gte: from } }];
  }
  // take 상한 — 한 달 이벤트가 수천 건씩 쌓인 프로젝트에서 달력이 응답을 못 받아 비는 현상 방지.
  const events = await prisma.projectEvent.findMany({
    where,
    orderBy: { startAt: "asc" },
    take: 2000,
  });
  res.json({ events });
});

// PATCH 에서 .partial() 을 쓸 수 있도록 base 는 ZodObject 로 유지하고, refine 은 별도 변형만 export.
const eventSchemaBase = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  // ISO 8601 확장 포맷도 40자면 충분. 파싱 실패 시 Prisma 500 으로 흐르지 않도록 사전 검증.
  startAt: z.string().min(1).max(40).refine(
    (s) => !Number.isNaN(new Date(s).getTime()),
    { message: "시작 시각 형식이 올바르지 않습니다" },
  ),
  endAt: z.string().min(1).max(40).refine(
    (s) => !Number.isNaN(new Date(s).getTime()),
    { message: "종료 시각 형식이 올바르지 않습니다" },
  ),
  allDay: z.boolean().optional(),
  color: z.string().max(16).optional(),
  // 담당자 수 상한 — 한 이벤트에 50명 이상은 현실적으로 없고, 지나치면 assigneeIds
  // 콤마 직렬화가 너무 길어져 DB 필드 / 목록 렌더링이 무거워짐.
  assigneeIds: z.array(z.string().max(64)).max(50).optional(),
  // 완료 토글 — 전체 수정 모달에서는 안 쓰이지만 PATCH 에서 같이 보낼 수 있게 허용.
  completed: z.boolean().optional(),
});
const eventSchema = eventSchemaBase.refine(
  (d) => new Date(d.endAt).getTime() >= new Date(d.startAt).getTime(),
  { message: "종료 시각이 시작 시각보다 빠릅니다", path: ["endAt"] },
);
// PATCH 는 일부 필드만 올 수 있으므로 둘 다 있을 때만 순서 검증.
const eventPatchSchema = eventSchemaBase.partial().refine(
  (d) => !d.startAt || !d.endAt || new Date(d.endAt).getTime() >= new Date(d.startAt).getTime(),
  { message: "종료 시각이 시작 시각보다 빠릅니다", path: ["endAt"] },
);

/** 담당자 userId 들이 모두 해당 프로젝트 멤버인지 검증하고 콤마 문자열로 직렬화. */
async function normalizeAssignees(projectId: string, ids: string[] | undefined): Promise<string | null> {
  if (!ids || ids.length === 0) return null;
  const unique = Array.from(new Set(ids));
  const members = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: unique } },
    select: { userId: true },
  });
  const valid = new Set(members.map((m) => m.userId));
  const filtered = unique.filter((id) => valid.has(id));
  return filtered.length ? filtered.join(",") : null;
}

router.post("/:id/events", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const assigneeIds = await normalizeAssignees(req.params.id, d.assigneeIds);
  const ev = await prisma.projectEvent.create({
    data: {
      projectId: req.params.id,
      title: d.title,
      description: d.description ?? null,
      startAt: new Date(d.startAt),
      endAt: new Date(d.endAt),
      allDay: !!d.allDay,
      color: d.color ?? "#3B5CF0",
      assigneeIds,
      createdById: u.id,
    },
  });
  res.json({ event: ev });
});

router.patch("/:id/events/:eventId", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  // IDOR 방어 — :eventId 가 :id 프로젝트 소속인지 확인. 빠뜨리면 다른 프로젝트 이벤트를
  // 우리 프로젝트 멤버 권한으로 수정할 수 있어 cross-project 일정 변조가 발생함.
  const existing = await prisma.projectEvent.findUnique({
    where: { id: req.params.eventId },
    select: { id: true, projectId: true },
  });
  if (!existing || existing.projectId !== req.params.id) {
    return res.status(404).json({ error: "not found" });
  }
  const parsed = eventPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  // 완료 상태 전환 시 누가 언제 완료했는지 자동으로 스탬프. 되돌릴 때는 초기화.
  const completedPatch =
    "completed" in d
      ? d.completed
        ? { completed: true, completedAt: new Date(), completedById: u.id }
        : { completed: false, completedAt: null, completedById: null }
      : {};
  const ev = await prisma.projectEvent.update({
    where: { id: req.params.eventId },
    data: {
      ...("title" in d ? { title: d.title! } : {}),
      ...("description" in d ? { description: d.description ?? null } : {}),
      ...("startAt" in d ? { startAt: new Date(d.startAt!) } : {}),
      ...("endAt" in d ? { endAt: new Date(d.endAt!) } : {}),
      ...("allDay" in d ? { allDay: !!d.allDay } : {}),
      ...("color" in d ? { color: d.color! } : {}),
      ...("assigneeIds" in d ? { assigneeIds: await normalizeAssignees(req.params.id, d.assigneeIds) } : {}),
      ...completedPatch,
    },
  });
  res.json({ event: ev });
});

router.delete("/:id/events/:eventId", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  // IDOR 방어 — :eventId 의 projectId 가 :id 와 일치해야 삭제 가능. 빠뜨리면
  // 다른 프로젝트 이벤트를 우리 프로젝트 멤버 권한으로 삭제할 수 있음.
  // deleteMany + where 로 1회 쿼리에 처리 (count===0 이면 404 처럼 처리).
  const r = await prisma.projectEvent.deleteMany({
    where: { id: req.params.eventId, projectId: req.params.id },
  });
  if (r.count === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

/* ---------------- 웹훅 채널 ---------------- */

/** 프로젝트의 웹훅 채널 목록. 최근 이벤트 카운트 포함. */
router.get("/:id/webhook", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  // take 상한 — 한 프로젝트에 수백 개 webhook 을 만들 일은 실무상 없으므로 100 으로 충분.
  const channels = await prisma.webhookChannel.findMany({
    where: { projectId: req.params.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { events: true } } },
    take: 100,
  });
  res.json({ channels });
});

const chCreateSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  color: z.string().max(16).optional(),
});

router.post("/:id/webhook", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const parsed = chCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const ch = await prisma.webhookChannel.create({
    data: {
      projectId: req.params.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? "#6366F1",
      token: generateWebhookToken(),
      createdById: u.id,
    },
  });
  await writeLog(u.id, "WEBHOOK_CHANNEL_CREATE", ch.id, parsed.data.name);
  res.json({ channel: ch });
});

/** 채널이 정말 이 프로젝트 소속인지 확인 — IDOR 방어 공통 헬퍼.
 *  routes 가 :id/webhook/:channelId 패턴이라 :channelId 만 받으면 cross-project 변조 가능. */
async function assertChannelInProject(projectId: string, channelId: string): Promise<boolean> {
  const ch = await prisma.webhookChannel.findUnique({
    where: { id: channelId },
    select: { projectId: true },
  });
  return !!ch && ch.projectId === projectId;
}

router.delete("/:id/webhook/:channelId", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  if (!(await assertChannelInProject(req.params.id, req.params.channelId))) {
    return res.status(404).json({ error: "not found" });
  }
  await prisma.webhookChannel.delete({ where: { id: req.params.channelId } });
  res.json({ ok: true });
});

/** token rotate — 기존 URL 무효화, 새 URL 로 교체. */
router.post("/:id/webhook/:channelId/rotate", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  if (!(await assertChannelInProject(req.params.id, req.params.channelId))) {
    return res.status(404).json({ error: "not found" });
  }
  const ch = await prisma.webhookChannel.update({
    where: { id: req.params.channelId },
    data: { token: generateWebhookToken() },
  });
  res.json({ channel: ch });
});

/** 채널별 수신 이벤트 피드 (최근순). */
router.get("/:id/webhook/:channelId/events", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  if (!(await assertChannelInProject(req.params.id, req.params.channelId))) {
    return res.status(404).json({ error: "not found" });
  }
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const events = await prisma.webhookEvent.findMany({
    where: { channelId: req.params.channelId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json({ events });
});

/* ---------------- QA 체크리스트 ---------------- */

// BUG=오류(신규 리포트), IN_PROGRESS=수정 중, NEEDS_FIX=수정필요,
// NEEDS_TEST=테스트 요망, DONE=완료, ON_HOLD=보류.
const QA_STATUS = ["BUG", "IN_PROGRESS", "NEEDS_FIX", "NEEDS_TEST", "DONE", "ON_HOLD"] as const;
const QA_PRIORITY = ["LOW", "NORMAL", "HIGH"] as const;
const QA_PLATFORM = ["WEB", "IOS", "ANDROID", "MAC_APP", "WINDOWS_APP", "OTHER"] as const;
const QA_ATTACHMENT_KIND = ["IMAGE", "VIDEO", "FILE"] as const;

/** 프로젝트의 QA 항목 목록. 생성 순서 + sortOrder 기준 정렬. */
router.get("/:id/qa", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const items = await prisma.projectQaItem.findMany({
    where: { projectId: req.params.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 1000,
    include: {
      attachments: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  // 작성자/해결자/담당자 이름은 목록 쿼리를 가볍게 유지하려고 별도 조회 후 map.
  const userIds = Array.from(
    new Set(
      items.flatMap((i) =>
        [i.createdById, i.resolvedById, i.assigneeId].filter(Boolean) as string[],
      ),
    ),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, avatarColor: true, isDeveloper: true, avatarUrl: true },
      })
    : [];
  const userMap = new Map(users.map((x) => [x.id, x]));
  res.json({
    items: items.map((i) => ({
      ...i,
      createdBy: userMap.get(i.createdById) ?? null,
      resolvedBy: i.resolvedById ? userMap.get(i.resolvedById) ?? null : null,
      assignee: i.assigneeId ? userMap.get(i.assigneeId) ?? null : null,
    })),
  });
});

// QA 첨부 url 은 반드시 우리 업로드 경로 — javascript:, data:, 외부 URL 모두 차단.
const SAFE_UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;
const qaAttachmentInput = z.object({
  url: z.string().min(1).max(500).regex(SAFE_UPLOAD_URL, { message: "/uploads/ 경로만 가능합니다" }),
  name: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(0).max(1_000_000_000),
  kind: z.enum(QA_ATTACHMENT_KIND),
});

const qaCreateSchema = z.object({
  title: z.string().min(1).max(200),
  note: z.string().max(4000).optional().nullable(),
  screen: z.string().max(200).optional().nullable(),
  platform: z.enum(QA_PLATFORM).optional().nullable(),
  assigneeId: z.string().max(50).optional().nullable(),
  priority: z.enum(QA_PRIORITY).optional(),
  status: z.enum(QA_STATUS).optional(),
  // 마감기한 — ISO 문자열 또는 null(해지). 빈 문자열은 들어오지 않도록 정규화는 클라이언트에서.
  dueDate: z.string().datetime().optional().nullable(),
  attachments: z.array(qaAttachmentInput).max(20).optional(),
});

// 담당자가 실제로 프로젝트 멤버인지 검증 — 없는 유저/다른 프로젝트 유저가 담당자로
// 잘못 꽂히는 것을 막는다. null 은 "담당자 해지" 로 해석.
async function resolveAssigneeIdOrThrow(
  projectId: string,
  assigneeId: string | null | undefined,
): Promise<string | null | undefined> {
  if (assigneeId === undefined) return undefined;
  if (!assigneeId) return null;
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: assigneeId } },
  });
  if (!m) throw new Error("ASSIGNEE_NOT_MEMBER");
  return assigneeId;
}

router.post("/:id/qa", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const parsed = qaCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;

  let assigneeId: string | null | undefined;
  try {
    assigneeId = await resolveAssigneeIdOrThrow(req.params.id, d.assigneeId);
  } catch {
    return res.status(400).json({ error: "담당자는 이 프로젝트 멤버여야 합니다" });
  }

  // sortOrder 기본값은 현재 최댓값 + 1 — 새 항목이 기본 맨 아래에 붙도록.
  const last = await prisma.projectQaItem.findFirst({
    where: { projectId: req.params.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const nextOrder = (last?.sortOrder ?? 0) + 1;
  // 기본 상태는 BUG(오류) — 리포트 시점에는 아직 손 대기 전.
  // BUG 가 아닌 상태로 바로 생성되면 "누가/언제 그 상태로 옮겼는지" 이력을 남긴다.
  const status = d.status ?? "BUG";
  const resolvedPatch =
    status !== "BUG"
      ? { resolvedById: u.id, resolvedAt: new Date() }
      : {};
  const item = await prisma.projectQaItem.create({
    data: {
      projectId: req.params.id,
      title: d.title,
      note: d.note ?? null,
      screen: d.screen ?? null,
      platform: d.platform ?? null,
      assigneeId: assigneeId ?? null,
      status,
      priority: d.priority ?? "NORMAL",
      sortOrder: nextOrder,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      createdById: u.id,
      ...resolvedPatch,
      ...(d.attachments && d.attachments.length
        ? {
            attachments: {
              create: d.attachments.map((a) => ({
                companyId: u.companyId,
                url: a.url,
                name: a.name,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
                kind: a.kind,
                uploadedById: u.id,
              })),
            },
          }
        : {}),
    },
    include: { attachments: { orderBy: { createdAt: "asc" } } },
  });
  await writeLog(u.id, "PROJECT_QA_CREATE", item.id, d.title);
  res.json({ item });
});

const qaPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  note: z.string().max(4000).optional().nullable(),
  screen: z.string().max(200).optional().nullable(),
  platform: z.enum(QA_PLATFORM).optional().nullable(),
  assigneeId: z.string().max(50).optional().nullable(),
  priority: z.enum(QA_PRIORITY).optional(),
  status: z.enum(QA_STATUS).optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  // null 은 해지, ISO 문자열은 설정.
  dueDate: z.string().datetime().optional().nullable(),
});

router.patch("/:id/qa/:itemId", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const parsed = qaPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;
  const existing = await prisma.projectQaItem.findUnique({
    where: { id: req.params.itemId },
  });
  if (!existing || existing.projectId !== req.params.id)
    return res.status(404).json({ error: "not found" });

  let assigneePatch: { assigneeId: string | null } | {} = {};
  if ("assigneeId" in d) {
    try {
      const resolved = await resolveAssigneeIdOrThrow(req.params.id, d.assigneeId);
      // undefined 는 미지정(노-op), null 은 해지.
      if (resolved !== undefined) assigneePatch = { assigneeId: resolved };
    } catch {
      return res.status(400).json({ error: "담당자는 이 프로젝트 멤버여야 합니다" });
    }
  }

  // 상태 전환 시 resolved 이력 스탬프 자동 관리.
  //  - BUG → IN_PROGRESS/DONE/ON_HOLD : 누가 언제 손댔는지 기록
  //  - * → BUG                         : 리오픈 — 기록 초기화
  //  - non-BUG 끼리 이동                : 이력 유지 (이미 누가 한 번 손댄 기록을 지우지 않음)
  const statusPatch =
    "status" in d
      ? d.status === "BUG"
        ? { status: "BUG", resolvedById: null, resolvedAt: null }
        : existing.status === "BUG"
        ? { status: d.status!, resolvedById: u.id, resolvedAt: new Date() }
        : { status: d.status! }
      : {};

  const item = await prisma.projectQaItem.update({
    where: { id: req.params.itemId },
    data: {
      ...("title" in d ? { title: d.title! } : {}),
      ...("note" in d ? { note: d.note ?? null } : {}),
      ...("screen" in d ? { screen: d.screen ?? null } : {}),
      ...("platform" in d ? { platform: d.platform ?? null } : {}),
      ...("priority" in d ? { priority: d.priority! } : {}),
      ...("sortOrder" in d ? { sortOrder: d.sortOrder! } : {}),
      ...("dueDate" in d ? { dueDate: d.dueDate ? new Date(d.dueDate) : null } : {}),
      ...assigneePatch,
      ...statusPatch,
    },
    include: { attachments: { orderBy: { createdAt: "asc" } } },
  });
  res.json({ item });
});

/** QA 항목에 첨부 추가 — 이미 업로드 완료된 파일의 메타데이터를 받아 레코드만 생성. */
router.post("/:id/qa/:itemId/attachment", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const parsed = qaAttachmentInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const existing = await prisma.projectQaItem.findUnique({
    where: { id: req.params.itemId },
    select: { id: true, projectId: true },
  });
  if (!existing || existing.projectId !== req.params.id)
    return res.status(404).json({ error: "not found" });

  const att = await prisma.projectQaAttachment.create({
    data: {
      qaItemId: existing.id,
      url: parsed.data.url,
      name: parsed.data.name,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      kind: parsed.data.kind,
      uploadedById: u.id,
    },
  });
  res.json({ attachment: att });
});

router.delete("/:id/qa/:itemId/attachment/:attachmentId", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const att = await prisma.projectQaAttachment.findUnique({
    where: { id: req.params.attachmentId },
    include: { qaItem: { select: { projectId: true, id: true } } },
  });
  if (!att || att.qaItemId !== req.params.itemId || att.qaItem.projectId !== req.params.id)
    return res.status(404).json({ error: "not found" });
  await prisma.projectQaAttachment.delete({ where: { id: att.id } });
  res.json({ ok: true });
});

router.delete("/:id/qa/:itemId", async (req, res) => {
  const u = (req as any).user;
  const ok = await assertProjectMember(req.params.id, u.id, u.role);
  if (!ok) return res.status(403).json({ error: "forbidden" });
  const existing = await prisma.projectQaItem.findUnique({
    where: { id: req.params.itemId },
  });
  if (!existing || existing.projectId !== req.params.id)
    return res.status(404).json({ error: "not found" });
  await prisma.projectQaItem.delete({ where: { id: req.params.itemId } });
  await writeLog(u.id, "PROJECT_QA_DELETE", req.params.itemId);
  res.json({ ok: true });
});

/** 멤버 추가 — OWNER/MANAGER 만. OWNER 승격은 기존 OWNER 또는 ADMIN 만 가능. */
router.post("/:id/member", async (req, res) => {
  const u = (req as any).user;
  const body = z.object({ userId: z.string().max(50), role: z.enum(["OWNER", "MANAGER", "MEMBER"]).optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid input" });
  const me = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: req.params.id, userId: u.id } },
  });
  if (!me && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  if (me && me.role === "MEMBER" && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  // OWNER 부여 권한 체크 — MANAGER 가 임의로 OWNER 를 만드는 것을 막는다.
  // 프로젝트 삭제 권한(line 112 부근) 이 OWNER 한 명만 갖는 구조라 OWNER 수를 엄격히 통제해야 함.
  const targetRole = body.data.role ?? "MEMBER";
  if (targetRole === "OWNER" && !(me?.role === "OWNER" || u.role === "ADMIN")) {
    return res.status(403).json({ error: "OWNER 역할은 기존 OWNER 또는 시스템 관리자만 부여할 수 있어요" });
  }
  const created = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: req.params.id, userId: body.data.userId } },
    update: { role: targetRole },
    create: { projectId: req.params.id, userId: body.data.userId, role: targetRole },
  });
  res.json({ member: created });
});

/** 멤버 제거 — OWNER/MANAGER 만, 본인은 자진 탈퇴 가능. */
router.delete("/:id/member/:userId", async (req, res) => {
  const u = (req as any).user;
  const me = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: req.params.id, userId: u.id } },
  });
  const isSelf = req.params.userId === u.id;
  if (!me && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  if (!isSelf && me && me.role === "MEMBER" && u.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } },
  });
  res.json({ ok: true });
});

export default router;
