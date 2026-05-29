import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireAuth, requireAdmin, writeLog } from "../lib/auth.js";

/* ===== 급여(임금)명세서 =====
 * - 작성·수정·삭제·목록(전체)·발송: ADMIN 전용.
 * - 직원 본인: 자기 명세서만 열람(GET) 가능. 그 외 권한 없음.
 * 금액은 모두 KRW 정수. 정산 항목 때문에 음수도 허용한다(예: 건강보험 정산 환급/추징).
 * 합계(지급/공제/실수령)는 서버가 earnings/deductions 로부터 항상 재계산해서 신뢰값으로 저장.
 */

const router = Router();
router.use(requireAuth);

const AMOUNT_MIN = -1_000_000_000;
const AMOUNT_MAX = 1_000_000_000;

const lineItem = z.object({
  label: z.string().min(1).max(60),
  amount: z.number().int().min(AMOUNT_MIN).max(AMOUNT_MAX),
});

const attendanceSchema = z
  .object({
    workDays: z.number().min(0).max(1000),
    totalHours: z.number().min(0).max(10000),
    overtimeHours: z.number().min(0).max(10000),
    nightHours: z.number().min(0).max(10000),
    holidayHours: z.number().min(0).max(10000),
    hourlyWage: z.number().min(0).max(10_000_000),
    familyCount: z.number().int().min(0).max(50),
  })
  .partial();

const calcRow = z.object({
  item: z.string().max(60),
  formula: z.string().max(300),
  amount: z.number().int().min(AMOUNT_MIN).max(AMOUNT_MAX),
});

const createSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  employeeId: z.string().min(1).max(40),
  companyName: z.string().min(1).max(100).optional(),
  employeeName: z.string().min(1).max(60).optional(),
  department: z.string().max(60).nullish(),
  position: z.string().max(60).nullish(),
  joinDate: z.string().max(40).nullish(),
  payDate: z.string().max(40).nullish(),
  idNumber: z.string().max(40).nullish(),
  earnings: z.array(lineItem).max(50),
  deductions: z.array(lineItem).max(50),
  attendance: attendanceSchema.nullish(),
  calcRows: z.array(calcRow).max(100).nullish(),
  memo: z.string().max(500).nullish(),
});

function computeTotals(
  earnings: { amount: number }[],
  deductions: { amount: number }[],
) {
  const totalEarnings = earnings.reduce((s, x) => s + x.amount, 0);
  const totalDeductions = deductions.reduce((s, x) => s + x.amount, 0);
  return { totalEarnings, totalDeductions, netPay: totalEarnings - totalDeductions };
}

const PAYSLIP_SELECT = {
  id: true,
  year: true,
  month: true,
  employeeId: true,
  companyName: true,
  employeeName: true,
  department: true,
  position: true,
  joinDate: true,
  payDate: true,
  idNumber: true,
  earnings: true,
  deductions: true,
  attendance: true,
  calcRows: true,
  memo: true,
  totalEarnings: true,
  totalDeductions: true,
  netPay: true,
  sentAt: true,
  sentTo: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, name: true, email: true, team: true, position: true } },
} satisfies Prisma.PayslipSelect;

/* ===== 직원 picker (ADMIN 전용) =====
 * 관리자 작성 화면에서 직원 선택 시 HR 필드 자동 채움용. 재직중인 사용자만.
 */
router.get("/employees", requireAdmin, async (_req, res) => {
  const employees = await prisma.user.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      position: true,
      team: true,
      department: true,
      employeeNo: true,
      hireDate: true,
      birthDate: true,
    },
  });
  res.json({ employees });
});

/* ===== 목록 =====
 * ADMIN: 전체. year/month/employeeId 로 필터 가능.
 * 일반 사용자: 본인 것만 강제(employeeId = 자신). 필터 무시.
 */
router.get("/", async (req, res) => {
  const u = (req as any).user;
  const where: any = { deletedAt: null };

  if (u.role === "ADMIN") {
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
  } else {
    where.employeeId = u.id;
  }

  const year = req.query.year ? Number(req.query.year) : NaN;
  const month = req.query.month ? Number(req.query.month) : NaN;
  if (Number.isInteger(year)) where.year = year;
  if (Number.isInteger(month)) where.month = month;

  const payslips = await prisma.payslip.findMany({
    where,
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
    take: 1000,
    select: PAYSLIP_SELECT,
  });
  res.json({ payslips });
});

/* ===== 단건 조회 =====
 * ADMIN: 모든 명세서. 일반 사용자: 본인 것만.
 */
router.get("/:id", async (req, res) => {
  const u = (req as any).user;
  const p = await prisma.payslip.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: PAYSLIP_SELECT,
  });
  if (!p) return res.status(404).json({ error: "not found" });
  if (u.role !== "ADMIN" && p.employeeId !== u.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json({ payslip: p });
});

/* ===== 작성 (ADMIN) ===== */
router.post("/", requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;

  // employeeId 가 실재하는 사용자인지 확인 + 표시용 기본값(이름) 확보.
  const employee = await prisma.user.findUnique({
    where: { id: d.employeeId },
    select: { id: true, name: true },
  });
  if (!employee) return res.status(400).json({ error: "대상 직원을 찾을 수 없어요" });

  // 같은 직원/연/월 명세서가 이미 있으면 중복 생성 막고 기존 id 안내 → 클라가 수정 유도.
  const dup = await prisma.payslip.findFirst({
    where: { employeeId: d.employeeId, year: d.year, month: d.month, deletedAt: null },
    select: { id: true },
  });
  if (dup) {
    return res
      .status(409)
      .json({ error: "이미 해당 월 명세서가 있어요", code: "DUPLICATE", id: dup.id });
  }

  const totals = computeTotals(d.earnings, d.deductions);
  const p = await prisma.payslip.create({
    data: {
      year: d.year,
      month: d.month,
      employeeId: d.employeeId,
      employeeName: d.employeeName ?? employee.name,
      companyName: d.companyName ?? undefined,
      department: d.department ?? null,
      position: d.position ?? null,
      joinDate: d.joinDate ?? null,
      payDate: d.payDate ?? null,
      idNumber: d.idNumber ?? null,
      earnings: d.earnings,
      deductions: d.deductions,
      attendance: d.attendance ?? Prisma.DbNull,
      calcRows: d.calcRows ?? Prisma.DbNull,
      memo: d.memo ?? undefined,
      ...totals,
      createdById: u.id,
    },
    select: PAYSLIP_SELECT,
  });
  await writeLog(u.id, "PAYSLIP_CREATE", p.id, `${d.year}-${d.month} ${p.employeeName}`);
  res.json({ payslip: p });
});

/* ===== 수정 (ADMIN) ===== */
router.patch("/:id", requireAdmin, async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.payslip.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true, earnings: true, deductions: true },
  });
  if (!exist) return res.status(404).json({ error: "not found" });

  // 부분 수정 허용. employeeId/year/month 변경은 중복키 혼란을 막기 위해 막는다.
  const parsed = createSchema
    .omit({ employeeId: true, year: true, month: true })
    .partial()
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const d = parsed.data;

  const data: Prisma.PayslipUpdateInput = {};
  if (d.employeeName !== undefined) data.employeeName = d.employeeName;
  if (d.companyName !== undefined) data.companyName = d.companyName;
  if (d.department !== undefined) data.department = d.department ?? null;
  if (d.position !== undefined) data.position = d.position ?? null;
  if (d.joinDate !== undefined) data.joinDate = d.joinDate ?? null;
  if (d.payDate !== undefined) data.payDate = d.payDate ?? null;
  if (d.idNumber !== undefined) data.idNumber = d.idNumber ?? null;
  if (d.memo !== undefined) data.memo = d.memo ?? null;
  if (d.earnings !== undefined) data.earnings = d.earnings;
  if (d.deductions !== undefined) data.deductions = d.deductions;
  if (d.attendance !== undefined) data.attendance = d.attendance ?? Prisma.DbNull;
  if (d.calcRows !== undefined) data.calcRows = d.calcRows ?? Prisma.DbNull;

  // earnings/deductions 중 하나라도 바뀌면 합계 재계산(나머지는 기존값 사용).
  if (d.earnings !== undefined || d.deductions !== undefined) {
    const earnings = (d.earnings ?? (exist.earnings as any)) as { amount: number }[];
    const deductions = (d.deductions ?? (exist.deductions as any)) as { amount: number }[];
    Object.assign(data, computeTotals(earnings, deductions));
  }

  const p = await prisma.payslip.update({
    where: { id: exist.id },
    data,
    select: PAYSLIP_SELECT,
  });
  await writeLog(u.id, "PAYSLIP_UPDATE", p.id, `${p.year}-${p.month} ${p.employeeName}`);
  res.json({ payslip: p });
});

/* ===== 삭제 (ADMIN, soft-delete) ===== */
router.delete("/:id", requireAdmin, async (req, res) => {
  const u = (req as any).user;
  const exist = await prisma.payslip.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true },
  });
  if (!exist) return res.status(404).json({ error: "not found" });
  await prisma.payslip.update({
    where: { id: exist.id },
    data: { deletedAt: new Date() },
  });
  await writeLog(u.id, "PAYSLIP_DELETE", exist.id);
  res.json({ ok: true });
});

export default router;
