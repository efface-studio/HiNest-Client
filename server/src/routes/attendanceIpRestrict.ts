/**
 * 회사 출근 IP 제한 관리 — 회사 관리자(ADMIN) 전용 CRUD.
 *
 * 라우터:
 *   GET    /api/admin/attendance-ip          현재 설정 + 화이트리스트 목록 + 내 현재 IP
 *   PATCH  /api/admin/attendance-ip          enabled toggle
 *   POST   /api/admin/attendance-ip          항목 추가 (CIDR + label)
 *   DELETE /api/admin/attendance-ip/:id      항목 삭제
 *
 * 슈퍼/플랫폼 어드민은 super-admin 콘솔에서 별도 관리. 여기는 회사 단위.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { isValidCidr, normalizeClientIp } from "../lib/ipMatch.js";

const router = Router();
router.use(requireAuth);

function requireCompanyAdmin(req: any, res: any) {
  const u = req.user;
  if (!u || u.role !== "ADMIN" || !u.companyId) {
    res.status(403).json({ error: "회사 관리자 권한이 필요합니다." });
    return null;
  }
  return u;
}

router.get("/", async (req, res) => {
  const u = requireCompanyAdmin(req, res);
  if (!u) return;
  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: {
      attendanceIpRestrictEnabled: true,
      allowedIps: {
        select: { id: true, cidr: true, label: true, createdAt: true, createdById: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  res.json({
    enabled: !!company?.attendanceIpRestrictEnabled,
    allowedIps: company?.allowedIps ?? [],
    clientIp: normalizeClientIp(req.ip),
  });
});

const patchSchema = z.object({ enabled: z.boolean() });
router.patch("/", async (req, res) => {
  const u = requireCompanyAdmin(req, res);
  if (!u) return;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  await prisma.company.update({
    where: { id: u.companyId },
    data: { attendanceIpRestrictEnabled: parsed.data.enabled },
  });
  await writeLog(u.id, "ATTENDANCE_IP_RESTRICT_TOGGLE", u.companyId, String(parsed.data.enabled));
  res.json({ ok: true, enabled: parsed.data.enabled });
});

const postSchema = z.object({
  cidr: z.string().trim().min(1).max(64),
  label: z.string().max(60).optional(),
});
router.post("/", async (req, res) => {
  const u = requireCompanyAdmin(req, res);
  if (!u) return;
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const cidr = parsed.data.cidr.trim();
  if (!isValidCidr(cidr)) {
    return res.status(400).json({ error: "올바른 IP 또는 CIDR 형식이 아닙니다 (예: 203.241.45.67 또는 192.168.1.0/24)." });
  }
  const created = await prisma.companyAttendanceAllowedIp.create({
    data: {
      companyId: u.companyId,
      cidr,
      label: parsed.data.label?.trim() || null,
      createdById: u.id,
    },
    select: { id: true, cidr: true, label: true, createdAt: true, createdById: true },
  });
  await writeLog(u.id, "ATTENDANCE_IP_RESTRICT_ADD", u.companyId, `${cidr}${parsed.data.label ? ` (${parsed.data.label})` : ""}`);
  res.json({ ok: true, item: created });
});

router.delete("/:id", async (req, res) => {
  const u = requireCompanyAdmin(req, res);
  if (!u) return;
  // 다른 회사 항목 삭제 차단 — companyId 필터.
  const result = await prisma.companyAttendanceAllowedIp.deleteMany({
    where: { id: req.params.id, companyId: u.companyId },
  });
  if (result.count === 0) return res.status(404).json({ error: "not found" });
  await writeLog(u.id, "ATTENDANCE_IP_RESTRICT_REMOVE", u.companyId, req.params.id);
  res.json({ ok: true });
});

export default router;
