import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, requirePlatformAdmin, writeLog } from "../lib/auth.js";
import { runUnscoped } from "../lib/tenant.js";

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

export default router;
