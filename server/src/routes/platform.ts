import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, requirePlatformAdmin, writeLog } from "../lib/auth.js";
import { runUnscoped } from "../lib/tenant.js";
import { notifyMany } from "../lib/notify.js";

/**
 * 플랫폼 운영 API — 회사(테넌트) 가입 승인 워크플로우.
 * platformAdmin 또는 개발자(superAdmin)만 접근하며 테넌트를 가로질러 동작한다.
 * (회사 내부 admin 과 구분 — 그쪽은 /api/admin.)
 */
const router = Router();
// 이 라우트들은 본질적으로 전 회사를 가로지른다(목록·승인 등). platformAdmin 은 세션
// 자체가 스코프 우회지만 superAdmin 은 평소 자기 회사로 스코프되므로, 이 구간만 명시적으로
// 스코프를 해제해 모든 회사 데이터를 읽고 쓸 수 있게 한다.
router.use(requireAuth, requirePlatformAdmin, (_req, _res, next) => runUnscoped(() => next()));

const VALID_STATUS = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"] as const;

// 회사 목록 — status 로 필터 가능. 신청 대기(PENDING) 우선 노출.
router.get("/companies", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : null;
  const where = status && VALID_STATUS.includes(status as any) ? { status } : {};
  const companies = await prisma.company.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: { _count: { select: { users: true } } },
  });
  res.json({ companies });
});

// 상태별 카운트 — 콘솔 상단 요약 배지용.
router.get("/companies/summary", async (_req, res) => {
  const grouped = await prisma.company.groupBy({ by: ["status"], _count: { _all: true } });
  const summary: Record<string, number> = { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 };
  for (const g of grouped) summary[g.status] = g._count._all;
  res.json({ summary });
});

router.get("/companies/:id", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!company) return res.status(404).json({ error: "not found" });
  // 첫 관리자(신청자) 정보 — 표시용.
  const admins = await prisma.user.findMany({
    where: { companyId: company.id, role: "ADMIN" },
    select: { id: true, name: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  res.json({ company, admins });
});

// 승인 — PENDING/SUSPENDED/REJECTED → ACTIVE.
router.post("/companies/:id/approve", async (req, res) => {
  const u = (req as any).user;
  const company = await prisma.company.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, status: true } });
  if (!company) return res.status(404).json({ error: "not found" });
  if (company.status === "ACTIVE") return res.status(400).json({ error: "이미 승인된 회사입니다" });

  const updated = await prisma.company.update({
    where: { id: company.id },
    data: {
      status: "ACTIVE",
      approvedAt: new Date(),
      approvedById: u.id,
      rejectedAt: null,
      rejectedReason: null,
      suspendedAt: null,
    },
  });
  await writeLog(u.id, "COMPANY_APPROVE", company.id, company.name, req.ip);
  res.json({ company: updated });
});

// 반려 — 사유 필수.
router.post("/companies/:id/reject", async (req, res) => {
  const u = (req as any).user;
  const parsed = z.object({ reason: z.string().min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "반려 사유를 입력해주세요" });
  const company = await prisma.company.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
  if (!company) return res.status(404).json({ error: "not found" });

  const updated = await prisma.company.update({
    where: { id: company.id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedReason: parsed.data.reason },
  });
  await writeLog(u.id, "COMPANY_REJECT", company.id, parsed.data.reason, req.ip);
  res.json({ company: updated });
});

// 일시 정지 — ACTIVE → SUSPENDED (로그인 차단, 데이터 보존).
router.post("/companies/:id/suspend", async (req, res) => {
  const u = (req as any).user;
  const company = await prisma.company.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
  if (!company) return res.status(404).json({ error: "not found" });

  const updated = await prisma.company.update({
    where: { id: company.id },
    data: { status: "SUSPENDED", suspendedAt: new Date() },
  });
  await writeLog(u.id, "COMPANY_SUSPEND", company.id, company.name, req.ip);
  res.json({ company: updated });
});

/* ===========================================================================
 * 알림 발송(브로드캐스트) — 전체 / 특정 회사 / 특정 사람에게 즉시 알림.
 * platformAdmin/개발자 전용. 알림 표준 경로(notifyMany)를 타므로 벨·SSE·APNs(폰 푸시)·
 * 사용자별 알림설정/DND 가 모두 그대로 적용된다.
 * ======================================================================== */

// 받는 사람 검색(특정 사람 선택용) — 이름/이메일 부분일치, 최대 50명. 회사명 동봉.
router.get("/users", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const companyId =
    typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : null;
  const where: any = { active: true };
  if (companyId) where.companyId = companyId;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, company: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 50,
  });
  res.json({ users });
});

const broadcastSchema = z.object({
  target: z.enum(["all", "company", "user"]),
  companyId: z.string().max(50).optional(),
  userId: z.string().max(50).optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(2000).optional(),
});

router.post("/broadcast", async (req, res) => {
  const u = (req as any).user;
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "제목과 대상을 확인해주세요" });
  const d = parsed.data;

  // 대상 활성 사용자 id 목록 결정.
  let userIds: string[] = [];
  let scopeLabel = "";
  let logTarget = "all";
  if (d.target === "all") {
    const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } });
    userIds = users.map((x) => x.id);
    scopeLabel = "전체";
  } else if (d.target === "company") {
    if (!d.companyId) return res.status(400).json({ error: "회사를 선택해주세요" });
    const company = await prisma.company.findUnique({
      where: { id: d.companyId },
      select: { id: true, name: true },
    });
    if (!company) return res.status(404).json({ error: "회사를 찾을 수 없습니다" });
    const users = await prisma.user.findMany({
      where: { active: true, companyId: company.id },
      select: { id: true },
    });
    userIds = users.map((x) => x.id);
    scopeLabel = `회사 「${company.name}」`;
    logTarget = company.id;
  } else {
    if (!d.userId) return res.status(400).json({ error: "받는 사람을 선택해주세요" });
    const target = await prisma.user.findUnique({
      where: { id: d.userId },
      select: { id: true, name: true, active: true },
    });
    if (!target) return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    if (!target.active) return res.status(400).json({ error: "비활성 사용자입니다" });
    userIds = [target.id];
    scopeLabel = `「${target.name}」`;
    logTarget = target.id;
  }

  if (!userIds.length) return res.json({ count: 0 });

  await notifyMany(
    userIds.map((id) => ({
      userId: id,
      type: "SYSTEM" as const,
      title: d.title,
      body: d.body,
      actorName: u.name,
    })),
  );
  await writeLog(
    u.id,
    "PLATFORM_BROADCAST",
    logTarget,
    `${scopeLabel} · ${d.title} → ${userIds.length}명`,
    req.ip,
  );
  res.json({ count: userIds.length });
});

export default router;
