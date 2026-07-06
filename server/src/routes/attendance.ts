import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { todayStr } from "../lib/dates.js";
import { ipMatchesAny, normalizeClientIp } from "../lib/ipMatch.js";
import { withinAnyGeofence, isValidLatLng } from "../lib/geoMatch.js";
import { normalizeSessions, workedMinutes, hasOpenSession, closeOpenSessions, type WorkSession } from "../lib/attendanceSessions.js";

const router = Router();
router.use(requireAuth);

// 오늘 출퇴근 상태 — sessions 합산 근무 분(workedMinutes)도 함께 내려준다.
// IP 자동 출근: 회사가 IP 제한을 켰고(allowedIps 존재), 허용 IP 에서 접속했고, 오늘 아직 출근
// 기록이 0건이면 출근 버튼 없이 자동 체크인(src="ip"). 하루 첫 접속 1회만(이후 세션 존재로 skip).
router.get("/today", async (req, res) => {
  const u = (req as any).user;
  const date = todayStr();
  let rec = await prisma.attendance.findUnique({
    where: { userId_date: { userId: u.id, date } },
  });
  let sessions = normalizeSessions(rec);

  if (sessions.length === 0 && u.companyId && !u.superAdmin && !u.platformAdmin) {
    const company = await prisma.company.findUnique({
      where: { id: u.companyId },
      select: { attendanceIpRestrictEnabled: true, allowedIps: { select: { cidr: true } } },
    });
    if (company?.attendanceIpRestrictEnabled && company.allowedIps.length > 0) {
      const clientIp = normalizeClientIp(req.ip);
      if (clientIp && ipMatchesAny(clientIp, company.allowedIps.map((a) => a.cidr))) {
        const now = new Date();
        const ipSession = [{ s: now.toISOString(), e: null, src: "ip" }] as unknown as object;
        rec = await prisma.attendance.upsert({
          where: { userId_date: { userId: u.id, date } },
          update: { sessions: ipSession, checkIn: now, checkOut: null },
          create: { userId: u.id, companyId: u.companyId, date, checkIn: now, sessions: ipSession },
        });
        sessions = normalizeSessions(rec);
        await writeLog(u.id, "CHECK_IN", date, "ip-auto");
      }
    }
  }

  res.json({
    attendance: rec,
    workedMinutes: workedMinutes(sessions),
    working: hasOpenSession(sessions),
  });
});

// 출근 — 다중 세션 방식. "다시 출근" 해도 이전 세션을 보존하고 새 세션을 추가한다.
//   (a) 기록 없음 → 새 세션으로 생성
//   (b) 이미 근무 중(열린 세션 존재) → 멱등(그대로 반환)
//   (c) 퇴근 후 다시 출근 → 새 세션 추가(이전 세션·시간 보존), checkOut 요약만 초기화
// 예전의 "checkOut 을 null 로 덮어써 퇴근 시각 소실" 버그 + 409 강제확인 흐름을 제거.
router.post("/check-in", async (req, res) => {
  const u = (req as any).user;
  const date = todayStr();

  // 회사 IP 화이트리스트 검사 — 관리자가 켜놓은 경우만. 매치 안 되면 403.
  // 슈퍼/플랫폼 어드민은 우회(원격 운영 편의). user 의 companyId 가 없으면(플랫폼 운영자) 우회.
  if (u.companyId && !u.superAdmin && !u.platformAdmin) {
    const company = await prisma.company.findUnique({
      where: { id: u.companyId },
      select: {
        attendanceIpRestrictEnabled: true,
        allowedIps: { select: { cidr: true } },
      },
    });
    if (company?.attendanceIpRestrictEnabled) {
      const clientIp = normalizeClientIp(req.ip);
      const allowed = !!clientIp && ipMatchesAny(clientIp, company.allowedIps.map((a) => a.cidr));
      if (!allowed) {
        await writeLog(u.id, "CHECK_IN_DENIED_IP", date, clientIp ?? "(no-ip)");
        return res.status(403).json({
          code: "IP_NOT_ALLOWED",
          error: "회사에서 허용한 IP 에서만 출근할 수 있어요. 사무실 네트워크에 연결됐는지 확인해 주세요.",
          clientIp,
        });
      }
    }
  }

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: u.id, date } },
  });
  const sessions = normalizeSessions(existing);

  // 이미 근무 중이면 멱등 — 새 세션을 또 열지 않는다.
  if (hasOpenSession(sessions)) {
    return res.json({ attendance: existing, workedMinutes: workedMinutes(sessions), working: true });
  }

  const now = new Date();
  sessions.push({ s: now.toISOString(), e: null, src: "manual" });
  const firstCheckIn = existing?.checkIn ?? now; // 최초 출근 시각 보존
  const rec = await prisma.attendance.upsert({
    where: { userId_date: { userId: u.id, date } },
    update: { sessions: sessions as unknown as object, checkIn: firstCheckIn, checkOut: null },
    create: {
      userId: u.id,
      companyId: u.companyId ?? null,
      date,
      checkIn: now,
      sessions: [{ s: now.toISOString(), e: null, src: "manual" }] as unknown as object,
    },
  });
  await writeLog(u.id, "CHECK_IN", date, sessions.length > 1 ? "re-in" : undefined);
  res.json({ attendance: rec, workedMinutes: workedMinutes(normalizeSessions(rec)), working: true });
});

// 퇴근 — 열린 세션을 닫는다(다중 세션 합산 보존). 출근 기록 없이 눌러도 안전.
router.post("/check-out", async (req, res) => {
  const u = (req as any).user;
  const date = todayStr();
  const now = new Date();
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: u.id, date } },
  });
  const sessions = normalizeSessions(existing);
  closeOpenSessions(sessions, now); // 열린 세션 종료
  const rec = await prisma.attendance.upsert({
    where: { userId_date: { userId: u.id, date } },
    update: { sessions: sessions as unknown as object, checkOut: now },
    create: { userId: u.id, companyId: u.companyId ?? null, date, checkOut: now },
  });
  await writeLog(u.id, "CHECK_OUT", date);
  res.json({ attendance: rec, workedMinutes: workedMinutes(normalizeSessions(rec)), working: false });
});

// 위치 자동출근 설정 조회 — 네이티브가 지오펜스 등록(OS 위치 모니터링)에 사용.
// 슈퍼/플랫폼 어드민·회사 없음은 enabled:false 로 응답(자동출근 대상 아님).
router.get("/geo-config", async (req, res) => {
  const u = (req as any).user;
  if (!u.companyId || u.superAdmin || u.platformAdmin) {
    return res.json({ enabled: false, geofences: [] });
  }
  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: {
      attendanceGeoEnabled: true,
      geofences: { select: { lat: true, lng: true, radiusM: true } },
    },
  });
  res.json({
    enabled: !!company?.attendanceGeoEnabled,
    geofences: company?.geofences ?? [],
  });
});

// 위치 기반 자동출근 — 네이티브가 회사 반경 진입 시 호출. 좌표가 등록된 지오펜스 안이면 출근.
// IP 자동출근(check-in src="ip")과 동일한 다중 세션 로직, src="geo".
//   (a) 회사 없음/슈퍼·플랫폼 어드민 → 400
//   (b) 위치 자동출근 꺼짐 or 지오펜스 0건 → 400 GEO_DISABLED
//   (c) 반경 밖 → 403 GEO_OUT_OF_RANGE
//   (d) 이미 근무 중(열린 세션 존재) → 멱등(현재 상태 반환, 중복 출근 X)
// IP 제한이 켜져 있어도 geo-check-in 은 통과 — 별개 경로.
const geoCheckInSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
});
router.post("/geo-check-in", async (req, res) => {
  const u = (req as any).user;
  if (!u.companyId || u.superAdmin || u.platformAdmin) {
    return res.status(400).json({ error: "위치 자동출근 대상이 아니에요." });
  }
  const parsed = geoCheckInSchema.safeParse(req.body);
  if (!parsed.success || !isValidLatLng(parsed.data.lat, parsed.data.lng)) {
    return res.status(400).json({ error: "올바른 좌표가 아니에요." });
  }
  const { lat, lng } = parsed.data;
  const date = todayStr();

  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: {
      attendanceGeoEnabled: true,
      geofences: { select: { lat: true, lng: true, radiusM: true } },
    },
  });
  if (!company?.attendanceGeoEnabled || company.geofences.length === 0) {
    return res.status(400).json({ code: "GEO_DISABLED", error: "위치 자동출근이 꺼져 있어요." });
  }
  if (!withinAnyGeofence(lat, lng, company.geofences)) {
    return res.status(403).json({ code: "GEO_OUT_OF_RANGE", error: "회사 위치 반경 밖이에요" });
  }

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: u.id, date } },
  });
  const sessions = normalizeSessions(existing);

  // 이미 근무 중이면 멱등 — 새 세션을 또 열지 않는다(반경 재진입 중복 출근 방지).
  if (hasOpenSession(sessions)) {
    return res.json({ attendance: existing, workedMinutes: workedMinutes(sessions), working: true });
  }

  const now = new Date();
  sessions.push({ s: now.toISOString(), e: null, src: "geo" });
  const firstCheckIn = existing?.checkIn ?? now; // 최초 출근 시각 보존
  const rec = await prisma.attendance.upsert({
    where: { userId_date: { userId: u.id, date } },
    update: { sessions: sessions as unknown as object, checkIn: firstCheckIn, checkOut: null },
    create: {
      userId: u.id,
      companyId: u.companyId ?? null,
      date,
      checkIn: now,
      sessions: [{ s: now.toISOString(), e: null, src: "geo" }] as unknown as object,
    },
  });
  await writeLog(u.id, "CHECK_IN", date, "geo-auto");
  res.json({ attendance: rec, workedMinutes: workedMinutes(normalizeSessions(rec)), working: true });
});

// 월별 근태 기록
router.get("/month", async (req, res) => {
  const u = (req as any).user;
  const month = String(req.query.month ?? ""); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month=YYYY-MM" });
  const prefix = month + "-";
  const list = await prisma.attendance.findMany({
    where: { userId: u.id, date: { startsWith: prefix } },
    orderBy: { date: "asc" },
  });
  res.json({ attendances: list });
});

// 휴가 신청
// TRIP = 외근 (출장/외부 미팅 등 — 사무실 밖에서 업무).
// 개별 날짜가 먼저 Invalid Date 인지 검증 — 그래야 순서 refine 메시지("종료일이 시작일보다 빠릅니다")가
// 잘못된 포맷 입력에 오해석되지 않는다.
const isoDateStr = z.string().max(40).refine(
  (s) => !Number.isNaN(new Date(s).getTime()),
  { message: "날짜 형식이 올바르지 않습니다" },
);
const leaveSchema = z
  .object({
    type: z.enum(["ANNUAL", "HALF", "SICK", "TRIP", "OTHER"]),
    startDate: isoDateStr,
    endDate: isoDateStr,
    reason: z.string().max(1000).optional(),
  })
  .refine(
    (d) => new Date(d.endDate).getTime() >= new Date(d.startDate).getTime(),
    { message: "종료일이 시작일보다 빠릅니다", path: ["endDate"] },
  );

router.post("/leave", async (req, res) => {
  const parsed = leaveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;
  const leave = await prisma.leave.create({
    data: {
      userId: u.id,
      type: d.type,
      startDate: new Date(d.startDate),
      endDate: new Date(d.endDate),
      reason: d.reason,
    },
  });
  await writeLog(u.id, "LEAVE_REQUEST", leave.id, d.type);
  res.json({ leave });
});

router.get("/leave", async (req, res) => {
  const u = (req as any).user;
  const all = req.query.all === "1" && (u.role === "ADMIN" || u.role === "MANAGER");
  const where: any = all ? {} : { userId: u.id };
  // MANAGER 는 본인 팀 휴가만 조회 가능.
  if (all && u.role === "MANAGER") {
    const me = await prisma.user.findUnique({ where: { id: u.id }, select: { team: true } });
    where.user = me?.team ? { team: me.team } : { id: "__none__" };
  }
  const leaves = await prisma.leave.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { user: { select: { name: true, team: true } } },
  });
  res.json({ leaves });
});

router.patch("/leave/:id", async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "ADMIN" && u.role !== "MANAGER")
    return res.status(403).json({ error: "forbidden" });
  const status = req.body?.status;
  if (!["APPROVED", "REJECTED", "PENDING"].includes(status))
    return res.status(400).json({ error: "invalid status" });
  const existing = await prisma.leave.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { team: true } } },
  });
  if (!existing) return res.status(404).json({ error: "not found" });
  // 본인 휴가를 직접 결재하는 것은 역할 무관 금지.
  if (existing.userId === u.id) {
    return res.status(403).json({ error: "본인의 휴가를 직접 심사할 수 없어요" });
  }
  // MANAGER 는 자기 팀 휴가만 심사 가능.
  if (u.role === "MANAGER") {
    const me = await prisma.user.findUnique({ where: { id: u.id }, select: { team: true } });
    if (!me?.team || existing.user?.team !== me.team) {
      return res.status(403).json({ error: "다른 팀의 휴가를 심사할 수 없어요" });
    }
  }
  const leave = await prisma.leave.update({
    where: { id: existing.id },
    data: { status, reviewer: u.id },
  });
  await writeLog(u.id, "LEAVE_REVIEW", leave.id, status);
  // 신청자에게 결재 결과 알림 — 승인/반려일 때만(보류 전환은 알리지 않음), 본인 심사 자기알림 방지.
  if ((status === "APPROVED" || status === "REJECTED") && existing.userId !== u.id) {
    await notify({
      userId: existing.userId,
      type: "APPROVAL_REVIEW",
      title: status === "APPROVED" ? "휴가 신청이 승인됐어요" : "휴가 신청이 반려됐어요",
      linkUrl: "/attendance",
      actorName: u.name,
    });
  }
  res.json({ leave });
});

/* ===== 야근(추가근무) 신청 =====
 * 연장 종료시각 지정. 승인되면:
 *  - (사전, 오늘+근무중) Attendance.overtimeUntil = 연장시각 → 자동퇴근을 그 시각까지 보류.
 *  - (사후, 퇴근했거나 과거날짜) 연장 블록을 세션으로 추가해 그 날짜 근무시간에 가산.
 */
const overtimeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  extendedEnd: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "유효한 일시가 아닙니다"),
  reason: z.string().max(1000).optional(),
});

router.post("/overtime", async (req, res) => {
  const parsed = overtimeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const u = (req as any).user;
  const d = parsed.data;
  const ot = await prisma.overtimeRequest.create({
    data: {
      userId: u.id,
      companyId: u.companyId ?? null,
      date: d.date,
      extendedEnd: new Date(d.extendedEnd),
      reason: d.reason,
    },
  });
  await writeLog(u.id, "OVERTIME_REQUEST", ot.id, `${d.date} → ${d.extendedEnd}`);
  res.json({ overtime: ot });
});

router.get("/overtime", async (req, res) => {
  const u = (req as any).user;
  const all = req.query.all === "1" && (u.role === "ADMIN" || u.role === "MANAGER");
  const where: any = all ? {} : { userId: u.id };
  if (all && u.role === "MANAGER") {
    const me = await prisma.user.findUnique({ where: { id: u.id }, select: { team: true } });
    where.user = me?.team ? { team: me.team } : { id: "__none__" };
  }
  if (all) where.companyId = u.companyId ?? null; // 같은 회사로 한정
  const list = await prisma.overtimeRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    // position(직급)은 야근 신청서 PDF(결재 서식)에 표기 — 이름·부서와 함께 내려준다.
    include: { user: { select: { name: true, team: true, position: true } } },
  });
  // 회사명 — 신청서 PDF 하단 사명 표기용 (멀티테넌트라 클라 하드코딩 금지, 1쿼리 추가)
  const company = u.companyId
    ? await prisma.company.findUnique({ where: { id: u.companyId }, select: { name: true } })
    : null;
  res.json({ overtimes: list, companyName: company?.name ?? null });
});

router.patch("/overtime/:id", async (req, res) => {
  const u = (req as any).user;
  if (u.role !== "ADMIN" && u.role !== "MANAGER") return res.status(403).json({ error: "forbidden" });
  const status = req.body?.status;
  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) return res.status(400).json({ error: "invalid status" });
  const ot = await prisma.overtimeRequest.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { team: true, workEndTime: true } } },
  });
  if (!ot) return res.status(404).json({ error: "not found" });
  if (ot.userId === u.id) return res.status(403).json({ error: "본인 신청은 직접 심사할 수 없어요" });
  if (u.role === "MANAGER") {
    const me = await prisma.user.findUnique({ where: { id: u.id }, select: { team: true } });
    if (!me?.team || ot.user?.team !== me.team) return res.status(403).json({ error: "다른 팀 신청을 심사할 수 없어요" });
  }

  const updated = await prisma.overtimeRequest.update({
    where: { id: ot.id }, data: { status, reviewer: u.id },
  });

  if (status === "APPROVED") {
    const ext = new Date(ot.extendedEnd);
    const wEnd = ot.user?.workEndTime || "18:00";
    const base = new Date(`${ot.date}T${wEnd}:00+09:00`); // 해당 날짜 근무종료시각(KST)
    const att = await prisma.attendance.findUnique({ where: { userId_date: { userId: ot.userId, date: ot.date } } });
    const sessions = normalizeSessions(att);
    const stillWorking = ot.date === todayStr() && hasOpenSession(sessions);
    if (stillWorking && att) {
      // 사전 승인 — 자동퇴근을 연장시각까지 미룬다(라이브 세션이 시간 계산).
      await prisma.attendance.update({ where: { id: att.id }, data: { overtimeUntil: ext } });
    } else {
      // 사후 승인 — 연장 블록 세션 추가(기존 기록과 겹치지 않게 시작 보정).
      const lastEnd = sessions.reduce((mx, s) => Math.max(mx, s.e ? new Date(s.e).getTime() : 0), 0);
      const startMs = Math.max(base.getTime(), lastEnd);
      if (ext.getTime() > startMs) {
        sessions.push({ s: new Date(startMs).toISOString(), e: ext.toISOString(), src: "overtime" });
        await prisma.attendance.upsert({
          where: { userId_date: { userId: ot.userId, date: ot.date } },
          update: { sessions: sessions as unknown as object, checkOut: ext },
          create: {
            userId: ot.userId, companyId: ot.companyId ?? null, date: ot.date, checkOut: ext,
            sessions: [{ s: new Date(startMs).toISOString(), e: ext.toISOString(), src: "overtime" }] as unknown as object,
          },
        });
      }
    }
  }

  await writeLog(u.id, "OVERTIME_REVIEW", ot.id, status);
  if ((status === "APPROVED" || status === "REJECTED") && ot.userId !== u.id) {
    await notify({
      userId: ot.userId,
      type: "APPROVAL_REVIEW",
      title: status === "APPROVED" ? "야근 신청이 승인됐어요" : "야근 신청이 반려됐어요",
      linkUrl: "/attendance",
      actorName: u.name,
    });
  }
  res.json({ overtime: updated });
});

export default router;
