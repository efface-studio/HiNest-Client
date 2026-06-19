/**
 * 회사 출근 위치(지오펜스) 관리 — 회사 관리자(ADMIN) 전용 CRUD.
 *
 * 라우터:
 *   GET    /api/admin/attendance-geo          현재 설정 + 등록된 사무실 위치 목록
 *   PATCH  /api/admin/attendance-geo          enabled toggle
 *   POST   /api/admin/attendance-geo          항목 추가 (lat/lng/radiusM + label)
 *   DELETE /api/admin/attendance-geo/:id      항목 삭제
 *
 * 슈퍼/플랫폼 어드민은 super-admin 콘솔에서 별도 관리. 여기는 회사 단위.
 * 출근 IP 제한(attendanceIpRestrict.ts)을 미러링한 별개 경로 — 둘은 독립적.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { isValidLatLng, isValidRadius } from "../lib/geoMatch.js";

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
      attendanceGeoEnabled: true,
      geofences: {
        select: { id: true, lat: true, lng: true, radiusM: true, label: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  res.json({
    enabled: !!company?.attendanceGeoEnabled,
    geofences: company?.geofences ?? [],
    // 서버는 클라 위치를 알 수 없음 — UI 의 "현재 위치 가져오기" 가 navigator.geolocation 으로 채움.
    clientLatLng: null,
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
    data: { attendanceGeoEnabled: parsed.data.enabled },
  });
  await writeLog(u.id, "ATTENDANCE_GEO_TOGGLE", u.companyId, String(parsed.data.enabled));
  res.json({ ok: true, enabled: parsed.data.enabled });
});

const postSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  radiusM: z.number().int().default(150),
  label: z.string().max(60).optional(),
});
router.post("/", async (req, res) => {
  const u = requireCompanyAdmin(req, res);
  if (!u) return;
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { lat, lng, radiusM } = parsed.data;
  if (!isValidLatLng(lat, lng)) {
    return res.status(400).json({ error: "올바른 좌표가 아니에요 (위도 -90~90, 경도 -180~180)." });
  }
  if (!isValidRadius(radiusM)) {
    return res.status(400).json({ error: "반경은 20m ~ 5000m 사이여야 해요." });
  }
  const created = await prisma.companyAttendanceGeofence.create({
    data: {
      companyId: u.companyId,
      lat,
      lng,
      radiusM,
      label: parsed.data.label?.trim() || null,
      createdById: u.id,
    },
    select: { id: true, lat: true, lng: true, radiusM: true, label: true, createdAt: true },
  });
  await writeLog(
    u.id,
    "ATTENDANCE_GEO_ADD",
    u.companyId,
    `${lat},${lng} r${radiusM}m${parsed.data.label ? ` (${parsed.data.label})` : ""}`,
  );
  res.json({ ok: true, item: created });
});

router.delete("/:id", async (req, res) => {
  const u = requireCompanyAdmin(req, res);
  if (!u) return;
  // 다른 회사 항목 삭제 차단 — companyId 필터.
  const result = await prisma.companyAttendanceGeofence.deleteMany({
    where: { id: req.params.id, companyId: u.companyId },
  });
  if (result.count === 0) return res.status(404).json({ error: "not found" });
  await writeLog(u.id, "ATTENDANCE_GEO_REMOVE", u.companyId, req.params.id);
  res.json({ ok: true });
});

export default router;
