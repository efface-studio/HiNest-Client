import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, writeLog } from "../lib/auth.js";
import { notify } from "../lib/notify.js";
import { todayStr } from "../lib/dates.js";
import { ipMatchesAny, normalizeClientIp } from "../lib/ipMatch.js";

const router = Router();
router.use(requireAuth);

// 오늘 출퇴근 상태
router.get("/today", async (req, res) => {
  const u = (req as any).user;
  const rec = await prisma.attendance.findUnique({
    where: { userId_date: { userId: u.id, date: todayStr() } },
  });
  res.json({ attendance: rec });
});

// 출근 — 하루에 여러 번 가능하지만, 이미 "출근 + 퇴근" 이 찍혀 있으면 한 번 더 확인을 받음.
// 기존엔 checkOut 을 무조건 null 로 덮어써 퇴근 시각이 소실되는 데이터 손실 버그가 있었음.
// 이제는:
//   (a) 기록 없음 → 신규 생성
//   (b) 출근만 있음 → checkIn 시각만 최신으로 덮어쓰기 (퇴근 기록은 건드리지 않음)
//   (c) 출근 + 퇴근 둘 다 있음 → 409 Conflict 반환. 클라가 { force: true } 로 재요청 시에만 퇴근 시각 초기화.
router.post("/check-in", async (req, res) => {
  const u = (req as any).user;
  const date = todayStr();
  const force = req.body?.force === true;

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
  if (existing?.checkOut && !force) {
    return res.status(409).json({
      code: "ALREADY_CHECKED_OUT",
      error: "오늘은 이미 퇴근 처리가 되어 있어요. 정말 재출근으로 덮어쓸까요?",
      attendance: existing,
    });
  }
  const now = new Date();
  const rec = await prisma.attendance.upsert({
    where: { userId_date: { userId: u.id, date } },
    update: force
      ? { checkIn: now, checkOut: null } // 명시적 동의 하에만 checkOut 초기화
      : { checkIn: now },
    create: { userId: u.id, date, checkIn: now },
  });
  await writeLog(u.id, "CHECK_IN", date, force ? "force" : undefined);
  res.json({ attendance: rec });
});

// 퇴근
// 출근 기록 없이 퇴근 눌러도 500 나지 않도록 upsert.
// (앱 재설치 직후, 새벽 경계 타이밍, 관리자 수동 조정 등 엣지 케이스 대응)
// create 시 checkIn 은 null 로 두고 checkOut 만 기록 — 리포트에서 "출근 누락 후 퇴근" 으로 보임.
router.post("/check-out", async (req, res) => {
  const u = (req as any).user;
  const date = todayStr();
  const now = new Date();
  const rec = await prisma.attendance.upsert({
    where: { userId_date: { userId: u.id, date } },
    update: { checkOut: now },
    create: { userId: u.id, date, checkOut: now },
  });
  await writeLog(u.id, "CHECK_OUT", date);
  res.json({ attendance: rec });
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
