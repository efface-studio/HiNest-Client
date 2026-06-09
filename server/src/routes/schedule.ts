import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { notifyMany } from "../lib/notify.js";
import { allSameCompanyUsers } from "../lib/tenantValidate.js";
import { getHiddenPositions, excludeHidden } from "../lib/hiddenPositions.js";

const router = Router();
router.use(requireAuth);

const CATEGORIES = [
  "MEETING",
  "DEADLINE",
  "OUT",
  "HOLIDAY",
  "EVENT",
  "BIRTHDAY",
  "TASK",
  "INTERVIEW",
  "TRAINING",
  "CLIENT",
  "SOCIAL",
  "HEALTH",
  "PERSONAL_C",
  "COMPANY_HOLIDAY",
  "COMPANY_LEAVE",
  "OTHER",
] as const;

const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  MEETING: "회의",
  DEADLINE: "마감",
  OUT: "외근·출장",
  HOLIDAY: "휴가",
  EVENT: "사내행사",
  BIRTHDAY: "기념일",
  TASK: "업무",
  INTERVIEW: "면접",
  TRAINING: "교육·워크샵",
  CLIENT: "고객·미팅",
  SOCIAL: "회식·모임",
  HEALTH: "건강·병원",
  PERSONAL_C: "개인일정",
  COMPANY_HOLIDAY: "사내 휴일",
  COMPANY_LEAVE: "전사 휴가",
  OTHER: "일반",
};

const ADMIN_ONLY_CATEGORIES = new Set(["COMPANY_HOLIDAY", "COMPANY_LEAVE"]);

/**
 * 일정 목록.
 * 공유 규칙:
 *  - COMPANY   → 모두 열람
 *  - TEAM      → 같은 team 에 속한 유저만 열람
 *  - PERSONAL  → 본인만 열람
 *  - TARGETED  → 지정된 targetUserIds 에 포함되거나 본인이 만든 일정만 열람
 */
router.get("/", async (req, res) => {
  const u = (req as any).user;
  // requireAuth 가 붙여둔 풀 유저행(30s 캐시) 재사용 — 매 목록 요청마다 하던 중복 self 조회 제거.
  const meUser = (req as any).userRecord;
  // Invalid Date 를 그대로 Prisma 에 넣으면 500 — 파싱 실패 시 필터 자체를 생략.
  const parseOrNull = (s: unknown) => {
    if (!s) return undefined;
    const d = new Date(String(s));
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const from = parseOrNull(req.query.from);
  const to = parseOrNull(req.query.to);

  // TEAM 스코프는 "내가 팀에 소속된 경우에만" 추가.
  // 기존 `team: meUser?.team ?? ""` 는 팀 없는 유저가 `team=""` 인 이벤트(가능: 관리자 실수 · 팀 삭제 후 잔존)를
  // 전부 열람하는 권한 누수였음. 팀이 없으면 TEAM 절 자체를 제거해 필터에서 배제.
  // 내가 멤버인 프로젝트 id 목록 — PROJECT 스코프 일정 필터에 사용.
  const myProjects = await prisma.projectMember.findMany({
    where: { userId: u.id },
    select: { projectId: true },
  });
  const myProjectIds = myProjects.map((m) => m.projectId);

  const orClauses: any[] = [
    { scope: "COMPANY" },
    { scope: "PERSONAL", createdBy: u.id },
    { scope: "TARGETED", createdBy: u.id },
    { scope: "TARGETED", targetUserIds: { contains: u.id } },
  ];
  if (meUser?.team) {
    orClauses.push({ scope: "TEAM", team: meUser.team });
  }
  if (myProjectIds.length) {
    orClauses.push({ scope: "PROJECT", projectId: { in: myProjectIds } });
  }
  const where: any = { OR: orClauses };
  if (from || to) {
    where.AND = [];
    if (from) where.AND.push({ endAt: { gte: from } });
    if (to) where.AND.push({ startAt: { lte: to } });
  }

  const events = await prisma.event.findMany({
    where,
    orderBy: { startAt: "asc" },
    // from/to 는 선택값 — 클라이언트(SchedulePage·DashboardPage)는 항상 보내지만,
    // 인증된 사용자가 둘 다 생략하면 가시 범위의 전체 이벤트가 무제한으로 내려간다.
    // document.ts 의 take:500 과 동일한 방어적 상한 — 실제 달력 윈도우는 한참 밑.
    take: 2000,
    include: {
      author: { select: { name: true, avatarColor: true, isDeveloper: true, avatarUrl: true } },
      project: { select: { id: true, name: true, color: true } },
    },
  });
  res.json({ events });
});

const eventSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(5000).optional(),
  scope: z.enum(["COMPANY", "TEAM", "PROJECT", "PERSONAL", "TARGETED"]).default("PERSONAL"),
  team: z.string().max(80).optional().nullable(),
  /// scope=PROJECT 인 경우 필수 — 현재 사용자가 멤버여야 함.
  projectId: z.string().max(50).optional().nullable(),
  category: z.enum(CATEGORIES).default("OTHER"),
  targetUserIds: z.array(z.string().max(50)).max(500).optional(),
  // ISO 8601 확장 포맷도 40자면 충분. 개별 포맷 오류는 순서 refine 메시지에 묻히지 않도록 먼저 검증.
  startAt: z.string().min(1).max(40).refine(
    (s) => !Number.isNaN(new Date(s).getTime()),
    { message: "시작 시각 형식이 올바르지 않습니다" },
  ),
  endAt: z.string().min(1).max(40).refine(
    (s) => !Number.isNaN(new Date(s).getTime()),
    { message: "종료 시각 형식이 올바르지 않습니다" },
  ),
  color: z.string().max(16).optional(),
}).refine(
  (d) => !d.startAt || !d.endAt || new Date(d.endAt).getTime() >= new Date(d.startAt).getTime(),
  { message: "종료일은 시작일과 같거나 뒤여야 해요", path: ["endAt"] },
);

router.post("/", async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;

  if (d.scope === "COMPANY" && u.role === "MEMBER")
    return res.status(403).json({ error: "전사 일정은 관리자/매니저만 등록 가능" });

  if (ADMIN_ONLY_CATEGORIES.has(d.category) && u.role === "MEMBER")
    return res.status(403).json({ error: "해당 카테고리는 관리자/매니저만 등록 가능" });

  // PROJECT 스코프는 해당 프로젝트 멤버만 등록 가능. projectId 필수.
  if (d.scope === "PROJECT") {
    if (!d.projectId) return res.status(400).json({ error: "프로젝트를 선택해주세요" });
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: d.projectId, userId: u.id } },
    });
    if (!membership) return res.status(403).json({ error: "프로젝트 멤버만 일정을 등록할 수 있어요" });
  }

  const me = (req as any).userRecord; // requireAuth 캐시 유저행 재사용 (중복 self 조회 제거)

  const targets = (d.targetUserIds ?? []).filter((id) => id && id !== u.id);
  if (targets.length && !(await allSameCompanyUsers(targets)))
    return res.status(400).json({ error: "대상자 중 일부를 찾을 수 없어요." });

  const ev = await prisma.event.create({
    data: {
      title: d.title,
      content: d.content,
      scope: d.scope,
      team: d.scope === "TEAM" ? (d.team ?? me?.team ?? null) : (d.team ?? null),
      projectId: d.scope === "PROJECT" ? d.projectId ?? null : null,
      category: d.category,
      targetUserIds: targets.length ? targets.join(",") : null,
      startAt: new Date(d.startAt),
      endAt: new Date(d.endAt),
      color: d.color ?? "#3B5CF0",
      createdBy: u.id,
    },
  });
  await writeLog(u.id, "EVENT_CREATE", ev.id, `${d.category}:${d.title}`);

  // 알림 대상 산정
  //  - COMPANY : 전원(본인 제외)
  //  - TEAM    : 같은 팀원(본인 제외)
  //  - TARGETED: 지정된 유저 + (선택) 본인 제외
  //  - PERSONAL: 없음
  let recipientIds: string[] = [];
  // 숨김 직급(테스트 계정 등) 사용자는 회사 공지/팀 일정 수신자에서 제외 — 디렉터리에서
  // 안 보이는 계정이 알림만 받는 모순을 막는다.
  const hidden = await getHiddenPositions(u.companyId);
  if (d.scope === "COMPANY") {
    const users = await prisma.user.findMany({
      where: { active: true, id: { not: u.id }, superAdmin: false, ...excludeHidden(hidden) },
      select: { id: true },
    });
    recipientIds = users.map((x) => x.id);
  } else if (d.scope === "TEAM") {
    const team = d.team ?? me?.team;
    if (team) {
      const users = await prisma.user.findMany({
        where: { active: true, team, id: { not: u.id }, ...excludeHidden(hidden) },
        select: { id: true },
      });
      recipientIds = users.map((x) => x.id);
    }
  } else if (d.scope === "PROJECT" && d.projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: d.projectId, userId: { not: u.id } },
      select: { userId: true },
    });
    recipientIds = members.map((m) => m.userId);
  } else if (d.scope === "TARGETED") {
    recipientIds = targets;
  }

  if (recipientIds.length) {
    const when = new Date(d.startAt).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const projName =
      d.scope === "PROJECT" && d.projectId
        ? (await prisma.project.findUnique({ where: { id: d.projectId }, select: { name: true } }))?.name ?? "프로젝트"
        : "";
    const scopeLabel =
      d.scope === "COMPANY"
        ? "전사 일정"
        : d.scope === "TEAM"
        ? `${d.team ?? me?.team ?? "팀"} 팀 일정`
        : d.scope === "PROJECT"
        ? `${projName} 프로젝트 일정`
        : "새 일정 태그";
    const categoryLabel = CATEGORY_LABEL[d.category];

    await notifyMany(
      recipientIds.map((rid) => ({
        userId: rid,
        type: d.scope === "TARGETED" ? ("MENTION" as const) : ("SYSTEM" as const),
        title: `${scopeLabel} · ${categoryLabel}`,
        body: `${u.name} · ${when}\n${d.title}`,
        linkUrl: `/schedule`,
        actorName: u.name,
      }))
    );
  }

  res.json({ event: ev });
});

router.delete("/:id", async (req, res) => {
  const u = (req as any).user;
  const ev = await prisma.event.findUnique({ where: { id: req.params.id } });
  if (!ev) return res.status(404).json({ error: "not found" });
  if (ev.createdBy !== u.id && u.role !== "ADMIN")
    return res.status(403).json({ error: "forbidden" });
  await prisma.event.delete({ where: { id: ev.id } });
  await writeLog(u.id, "EVENT_DELETE", ev.id);
  res.json({ ok: true });
});

export default router;
