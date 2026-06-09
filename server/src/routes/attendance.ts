import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { todayStr } from "../lib/dates.js";
import { ipMatchesAny, normalizeClientIp } from "../lib/ipMatch.js";
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

export default router;
