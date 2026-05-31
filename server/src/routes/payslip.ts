import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireAuth, requireAdmin, writeLog } from "../lib/auth.js";
import { sendEmailWithAttachment } from "../lib/email.js";

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

/* ===== 메일 발송 (ADMIN) =====
 * 클라이언트가 명세서를 PDF(base64)로 렌더해 보내면, 서버는 직원 계정 이메일로 첨부 발송.
 * PDF 는 클라가 만든다(서버에 Chromium/폰트 안 올리려고). 서버는 매직바이트/크기만 검증.
 * 발송 성공 시에만 sentAt/sentTo 기록 — 실패 시 502, 상태 안 바꿈.
 */
const PDF_MAX_BYTES = 6_000_000; // 디코드 후 6MB 상한(전역 JSON 2mb 제한과 별개 안전망).

const sendSchema = z.object({
  // base64 는 원본보다 ~33% 크다. 6MB PDF ≈ 8MB base64.
  pdfBase64: z.string().min(1).max(8_000_000),
});

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wonKR(n: number): string {
  return `${Number(n || 0).toLocaleString("ko-KR")}원`;
}

/**
 * 급여명세서 안내 메일 HTML.
 * 이메일 클라이언트(Gmail/Outlook/Apple Mail) 호환을 위해 table 레이아웃 + 인라인 스타일만 사용.
 * 브랜드 색(#3B5CF0) 헤더 + 실수령액 강조 요약 카드. 상세 내역은 첨부 PDF 에 있으므로
 * 본문엔 비밀/민감정보가 없다(합계 수준 요약만).
 */
function payslipEmailHtml(a: {
  company: string;
  employeeName: string;
  year: number;
  month: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  metaLines: string[];
  /** 발송한 담당자 이메일 — 있으면 "담당자에게 회신" 버튼(mailto)을 노출. */
  replyToEmail?: string;
}): string {
  const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";
  const meta = a.metaLines.length
    ? `<p style="margin:16px 0 0;font-size:12.5px;color:#6B7280;line-height:1.7">${a.metaLines
        .map(escHtml)
        .join("<br/>")}</p>`
    : "";
  // 담당자 회신 버튼(mailto) — 제목 프리필. encodeURIComponent 출력은 ASCII 라 href 속성에 안전.
  const replyBtn = a.replyToEmail
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 2px"><tr>` +
      `<td style="border-radius:10px;background:#3B5CF0">` +
      `<a href="mailto:${escHtml(a.replyToEmail)}?subject=${encodeURIComponent(`[문의] ${a.year}년 ${a.month}월 급여명세서`)}" ` +
      `style="display:inline-block;padding:11px 22px;font-size:13.5px;font-weight:700;color:#FFFFFF;text-decoration:none">담당자에게 회신</a>` +
      `</td></tr></table>`
    : "";
  // 회신 가능하면 푸터에서 "발신 전용" 문구를 빼고 회신 안내로 대체.
  const footerNote = a.replyToEmail
    ? `문의 사항은 위 <b>담당자에게 회신</b> 버튼으로 연락해 주세요.<br/>${escHtml(a.company)}`
    : `본 메일은 발신 전용입니다. 문의는 담당자에게 연락해 주세요.<br/>${escHtml(a.company)}`;
  return (
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${a.year}년 ${a.month}월 급여명세서 · 실수령액 ${wonKR(a.netPay)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;font-family:${FONT}">` +
    `<tr><td align="center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB">` +
    // 헤더 (브랜드 바)
    `<tr><td style="background:#3B5CF0;padding:24px 28px">` +
    `<div style="color:#C9D5FF;font-size:12px;font-weight:700;letter-spacing:.04em">${escHtml(a.company)}</div>` +
    `<div style="color:#FFFFFF;font-size:20px;font-weight:800;margin-top:5px">${a.year}년 ${a.month}월 급여명세서</div>` +
    `</td></tr>` +
    // 본문
    `<tr><td style="padding:28px 28px 24px">` +
    `<p style="margin:0 0 18px;font-size:15px;color:#111827;line-height:1.6"><b>${escHtml(a.employeeName)}</b>님, ${a.year}년 ${a.month}월 급여명세서를 보내드립니다.</p>` +
    // 요약 카드
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3FF;border-radius:12px">` +
    `<tr><td style="padding:18px 20px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
    `<tr><td style="font-size:13px;color:#4B5563;padding:3px 0">지급 합계</td><td align="right" style="font-size:13px;color:#111827;font-weight:600;padding:3px 0">${wonKR(a.totalEarnings)}</td></tr>` +
    `<tr><td style="font-size:13px;color:#4B5563;padding:3px 0">공제 합계</td><td align="right" style="font-size:13px;color:#DC2626;font-weight:600;padding:3px 0">${wonKR(a.totalDeductions)}</td></tr>` +
    `</table>` +
    `<div style="border-top:1px solid #D6E0FF;margin-top:12px;padding-top:12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="font-size:14px;color:#1D3AB8;font-weight:700;vertical-align:middle">실수령액</td>` +
    `<td align="right" style="font-size:22px;color:#1D3AB8;font-weight:800;vertical-align:middle">${wonKR(a.netPay)}</td>` +
    `</tr></table>` +
    `</div>` +
    `</td></tr></table>` +
    meta +
    `<p style="margin:16px 0 0;font-size:13px;color:#374151;line-height:1.6">자세한 지급·공제 내역은 첨부된 PDF 명세서를 확인해 주세요.</p>` +
    replyBtn +
    `</td></tr>` +
    // 푸터
    `<tr><td style="padding:16px 28px;background:#FAFAFB;border-top:1px solid #EEF0F2">` +
    `<div style="font-size:11.5px;color:#9CA3AF;line-height:1.6">${footerNote}</div>` +
    `</td></tr>` +
    `</table></td></tr></table>`
  );
}

router.post("/:id/send", requireAdmin, async (req, res) => {
  const u = (req as any).user;
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });

  const p = await prisma.payslip.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: PAYSLIP_SELECT,
  });
  if (!p) return res.status(404).json({ error: "not found" });

  const to = p.employee?.email;
  if (!to) return res.status(400).json({ error: "직원 계정 이메일이 없어요" });

  // base64 → 버퍼. PDF 매직바이트("%PDF-")와 크기 검증으로 엉뚱한 첨부 차단.
  const pdf = Buffer.from(parsed.data.pdfBase64, "base64");
  if (pdf.length === 0 || pdf.length > PDF_MAX_BYTES) {
    return res.status(400).json({ error: "PDF 크기가 올바르지 않아요" });
  }
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return res.status(400).json({ error: "PDF 형식이 아니에요" });
  }

  const company = p.companyName || "주식회사 하이비츠";
  const subject = `[${company}] ${p.year}년 ${p.month}월 급여명세서`;
  const filename = `payslip_${p.year}_${String(p.month).padStart(2, "0")}.pdf`;

  // 발송을 누른 담당자(요청한 ADMIN) — 수신자가 회신할 주소로 사용.
  // AuthUser.email/name 은 항상 존재하지만 방어적으로 truthy 체크.
  const replyToEmail = (u.email as string) || undefined;
  const replyToName = (u.name as string) || undefined;

  // 부서·직위·지급일 메타 — 값이 있는 줄만 노출.
  const metaLines = [
    [p.department, p.position].filter(Boolean).join(" · "),
    p.payDate ? `지급일 ${p.payDate}` : "",
  ].filter(Boolean);

  const contactLine = replyToEmail
    ? `문의: ${replyToName ? `${replyToName} ` : ""}<${replyToEmail}> (이 메일에 회신하셔도 됩니다)`
    : "본 메일은 발신 전용입니다.";

  const text =
    `${p.employeeName}님, ${p.year}년 ${p.month}월 급여명세서를 보내드립니다.\n\n` +
    `· 지급 합계: ${wonKR(p.totalEarnings)}\n` +
    `· 공제 합계: ${wonKR(p.totalDeductions)}\n` +
    `· 실수령액: ${wonKR(p.netPay)}\n\n` +
    `자세한 내역은 첨부된 PDF 명세서를 확인해 주세요.\n\n` +
    `${contactLine}\n${company}`;

  const html = payslipEmailHtml({
    company,
    employeeName: p.employeeName,
    year: p.year,
    month: p.month,
    totalEarnings: p.totalEarnings,
    totalDeductions: p.totalDeductions,
    netPay: p.netPay,
    metaLines,
    replyToEmail,
  });

  const result = await sendEmailWithAttachment({
    to,
    subject,
    text,
    html,
    replyTo: replyToEmail,
    replyToName,
    attachments: [{ filename, contentBase64: parsed.data.pdfBase64, contentType: "application/pdf" }],
  });
  if (!result.ok) {
    return res.status(502).json({ error: "메일 발송에 실패했어요", reason: result.reason });
  }

  const updated = await prisma.payslip.update({
    where: { id: p.id },
    data: { sentAt: new Date(), sentTo: to },
    select: PAYSLIP_SELECT,
  });
  await writeLog(u.id, "PAYSLIP_SEND", p.id, `${p.year}-${p.month} ${p.employeeName}`);
  res.json({ payslip: updated });
});

export default router;
