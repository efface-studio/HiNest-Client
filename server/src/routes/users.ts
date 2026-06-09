import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { todayStr } from "../lib/dates.js";
import { getHiddenPositions, excludeHidden } from "../lib/hiddenPositions.js";

const router = Router();
router.use(requireAuth);

// 팀원 목록 (일반 유저도 볼 수 있음) — 총관리자는 자신 외엔 보이지 않음
// 업무 상태(presence) + 오늘 출퇴근 요약 포함

router.get("/", async (req, res) => {
  const u = (req as any).user;
  // 종전엔 superAdmin 계정을 다른 사람에게 숨겼지만, \"HiNest 개발자\" 딱지가 별도 정체성으로 자리잡아
  // 더 이상 숨길 이유가 없음. 모든 활성 사용자를 노출하고 권한 표시는 칩으로.
  // 숨김 직급(Position.hidden=true) 사용자는 디렉터리에서 제외(본인은 예외 — 자기 자신 보기 OK).
  const hidden = await getHiddenPositions(u.companyId);
  const users = await prisma.user.findMany({
    where: { active: true, ...excludeHidden(hidden, { exceptId: u.id }) },
    orderBy: { name: "asc" },
    take: 5000,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      team: true,
      position: true,
      avatarColor: true,
      avatarUrl: true,
      isDeveloper: true,
      presenceStatus: true,
      presenceMessage: true,
      presenceUpdatedAt: true,
    },
  });
  const date = todayStr();
  const ids = users.map((u) => u.id);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday); endOfToday.setDate(endOfToday.getDate() + 1);

  const [attendances, leaves] = await Promise.all([
    prisma.attendance.findMany({
      where: { date, userId: { in: ids } },
      select: { userId: true, checkIn: true, checkOut: true },
    }),
    prisma.leave.findMany({
      where: {
        status: "APPROVED",
        userId: { in: ids },
        startDate: { lt: endOfToday },
        endDate: { gte: startOfToday },
      },
      select: { userId: true, type: true },
    }),
  ]);
  const attMap = new Map(attendances.map((a) => [a.userId, a]));
  const priority: Record<string, number> = { TRIP: 3, HALF: 2, ANNUAL: 1, SICK: 1, OTHER: 1 };
  const leaveMap = new Map<string, string>();
  for (const l of leaves) {
    const prev = leaveMap.get(l.userId);
    if (!prev || (priority[l.type] ?? 0) > (priority[prev] ?? 0)) leaveMap.set(l.userId, l.type);
  }

  const enriched = users.map((x) => {
    const a = attMap.get(x.id);
    const leaveType = leaveMap.get(x.id);
    let workStatus: "IN" | "OFF" | "NONE" | "LEAVE" | "HALF_LEAVE" | "TRIP";
    if (leaveType === "TRIP") workStatus = "TRIP";
    else if (leaveType === "HALF") workStatus = "HALF_LEAVE";
    else if (leaveType) workStatus = "LEAVE";
    else workStatus = a?.checkOut ? "OFF" : a?.checkIn ? "IN" : "NONE";
    return { ...x, workStatus, checkIn: a?.checkIn ?? null, checkOut: a?.checkOut ?? null, leaveType: leaveType ?? null };
  });

  // 전체 목록은 30초간 브라우저 캐시 허용. presenceStatus 는 SSE 로 실시간 업데이트되므로 괜찮음.
  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  res.json({ users: enriched });
});

/**
 * 경량 Presence 전용 엔드포인트 — ChatMiniApp 이 30초마다 폴링할 때 사용.
 * 전체 유저 목록 대신 id + presenceStatus + workStatus 만 반환 → 응답 크기 ~8x 감소.
 */
router.get("/presence", async (req, res) => {
  const u = (req as any).user;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday); endOfToday.setDate(endOfToday.getDate() + 1);
  const date = todayStr();

  // 숨김 직급 사용자는 presence 폴링 결과에서도 제외(디렉터리 ↔ presence 일관).
  const hidden = await getHiddenPositions(u.companyId);
  const [users, attendances, leaves] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, superAdmin: false, ...excludeHidden(hidden, { exceptId: u.id }) },
      select: { id: true, presenceStatus: true, presenceMessage: true },
      take: 5000,
    }),
    prisma.attendance.findMany({
      where: { date },
      select: { userId: true, checkIn: true, checkOut: true },
    }),
    prisma.leave.findMany({
      where: {
        status: "APPROVED",
        startDate: { lt: endOfToday },
        endDate: { gte: startOfToday },
      },
      select: { userId: true, type: true },
    }),
  ]);

  const attMap = new Map(attendances.map((a) => [a.userId, a]));
  const priority: Record<string, number> = { TRIP: 3, HALF: 2, ANNUAL: 1, SICK: 1, OTHER: 1 };
  const leaveMap = new Map<string, string>();
  for (const l of leaves) {
    const prev = leaveMap.get(l.userId);
    if (!prev || (priority[l.type] ?? 0) > (priority[prev] ?? 0)) leaveMap.set(l.userId, l.type);
  }

  const result = users.map((x) => {
    const a = attMap.get(x.id);
    const lt = leaveMap.get(x.id);
    let workStatus: string;
    if (lt === "TRIP") workStatus = "TRIP";
    else if (lt === "HALF") workStatus = "HALF_LEAVE";
    else if (lt) workStatus = "LEAVE";
    else workStatus = a?.checkOut ? "OFF" : a?.checkIn ? "IN" : "NONE";
    return { id: x.id, presenceStatus: x.presenceStatus, presenceMessage: x.presenceMessage, workStatus };
  });

  res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
  res.json({ users: result });
});

/** 단일 유저 상세 — 다른 사람 프로필 페이지에서 사용. 본인이 아니어도 조회 가능하지만
 *  민감 정보(이메일/사번 등 HR 필드)는 ADMIN+ 가 아니면 가림. */
router.get("/:id", async (req, res) => {
  const me = (req as any).user;
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      email: true,
      team: true,
      position: true,
      role: true,
      avatarColor: true,
      avatarUrl: true,
      isDeveloper: true,
      active: true,
      employeeNo: true,
      hireDate: true,
      phone: true,
      presenceStatus: true,
      presenceMessage: true,
      presenceUpdatedAt: true,
      superAdmin: true,
      createdAt: true,
    },
  });
  if (!target) return res.status(404).json({ error: "not found" });
  // 종전엔 superAdmin 계정을 일반 유저에게 404 위장했으나 \"HiNest 개발자\" 가 별도 정체성으로
  // 자리잡아 더 이상 숨길 이유가 없음. 누구든 프로필 페이지로 진입 가능.
  const isAdminOrSelf = me.role === "ADMIN" || me.role === "MANAGER" || me.id === target.id;
  // 민감 HR 필드는 ADMIN/MANAGER 또는 본인에게만.
  const masked = {
    ...target,
    employeeNo: isAdminOrSelf ? target.employeeNo : null,
    hireDate: isAdminOrSelf ? target.hireDate : null,
    phone: isAdminOrSelf ? target.phone : null,
    email: isAdminOrSelf ? target.email : maskEmail(target.email),
  };
  // superAdmin 필드는 응답에서 제거 — 클라가 알 필요 없음.
  delete (masked as any).superAdmin;
  res.json({ user: masked });
});

function maskEmail(email: string): string {
  // a***@domain.com — 디렉토리·검색 결과처럼 정체성은 살리되 정확한 ID 는 가림.
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const head = local[0] ?? "";
  return `${head}***@${domain}`;
}

// (GET /users/teams 제거 — router.get("/:id") 가 먼저 등록돼 "/teams" 가 id="teams" 로
//  매칭되는 도달 불가(dead) 라우트였고, 모듈 전역 _teamsCache 는 companyId 키가 없어
//  살아날 경우 회사 간 팀명 누수 위험이 있었다. 클라이언트는 팀 목록을 users 배열에서
//  파생하므로 이 엔드포인트를 호출하지 않는다(OrgChartPage 주석 참고). 캐시·무효화 함수 함께 제거.)

export default router;
