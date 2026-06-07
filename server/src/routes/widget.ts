/**
 * 위젯 전용 가벼운 endpoint 모음 — iOS/iPadOS/macOS WidgetKit 에서 호출.
 *
 * WidgetKit 페이로드는 ~16KB 정도가 한계라 일반 API 응답(작성자·반응 등 풀 필드)을
 * 그대로 쓰면 너무 크고 느림. 위젯은 최소 필드만 반환하는 별도 endpoint 가 깔끔.
 *
 * 인증: 일반 requireAuth — 메인 앱이 App Group 으로 토큰을 위젯과 공유.
 *      위젯 timeline provider 가 그 토큰으로 직접 호출한다.
 */
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { todayStr } from "../lib/dates.js";

const router = Router();
router.use(requireAuth);

/** "HH:mm" → 분(0~1439). 형식 안 맞으면 null. */
function parseHHmm(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
function fmtHHmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * GET /api/widget/schedule/today
 *   - 지금부터 다음 24h 안에 시작하거나 진행 중인 일정 ~12건
 *   - 최소 필드: id, title, startAt, endAt, color, category
 *   - 정렬: startAt 오름차순
 */
router.get("/schedule/today", async (req, res) => {
  const u = (req as any).user;
  const meUser = (req as any).userRecord;
  const now = new Date();
  const next = new Date(now.getTime() + 36 * 3600 * 1000); // 살짝 여유 + 다음 날 일정 일부까지

  const myProjects = await prisma.projectMember.findMany({
    where: { userId: u.id },
    select: { projectId: true },
  });
  const myProjectIds = myProjects.map((m) => m.projectId);

  const orClauses: any[] = [
    { scope: "COMPANY" },
    { scope: "PERSONAL", createdBy: u.id },
    { scope: "TARGETED", createdBy: u.id },
    { scope: "TARGETED", targetUserIds: { contains: u.id } },
  ];
  if (meUser?.team) orClauses.push({ scope: "TEAM", team: meUser.team });
  if (myProjectIds.length) orClauses.push({ scope: "PROJECT", projectId: { in: myProjectIds } });

  const events = await prisma.event.findMany({
    where: {
      OR: orClauses,
      AND: [
        { endAt: { gte: now } },     // 이미 끝난 것 제외
        { startAt: { lte: next } },  // 36h 안에 시작하는 것
      ],
    },
    orderBy: { startAt: "asc" },
    take: 12,
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      color: true,
      category: true,
    },
  });

  // 위젯 캐시 정책 — 30초간 stale OK. Cache-Control 은 사설 토큰 인증이라 private.
  res.set("Cache-Control", "private, max-age=30");
  res.json({
    events,
    // 위젯 refresh 다음 시각 힌트 — 새 이벤트가 곧 시작하면 그 시각 직전에 갱신.
    nextRefreshAt: events[0]?.startAt ?? new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    generatedAt: now.toISOString(),
  });
});

/**
 * GET /api/widget/work-status
 *   - 오늘 출퇴근 상태 + 근무 경과시간 + 9to6(또는 설정) 기준 진행률
 *   - status: NONE(미출근) | IN(근무중) | OFF(퇴근)
 *   - workedMin: 출근~지금(또는 퇴근) 경과 분. targetMin: 근무 목표 분(기본 540=9h).
 *   - percent: workedMin/targetMin (0~100)
 */
router.get("/work-status", async (req, res) => {
  const u = (req as any).user;
  const date = todayStr();
  const [rec, userRow] = await Promise.all([
    prisma.attendance.findUnique({ where: { userId_date: { userId: u.id, date } } }),
    prisma.user.findUnique({ where: { id: u.id }, select: { workStartTime: true, workEndTime: true } }),
  ]);

  const now = Date.now();
  const checkIn = rec?.checkIn ? new Date(rec.checkIn).getTime() : null;
  const checkOut = rec?.checkOut ? new Date(rec.checkOut).getTime() : null;
  const workedMin = checkIn ? Math.max(0, Math.floor(((checkOut ?? now) - checkIn) / 60000)) : 0;

  const startMin = parseHHmm(userRow?.workStartTime) ?? 9 * 60;
  const endMin = parseHHmm(userRow?.workEndTime) ?? 18 * 60;
  const targetMin = Math.max(1, endMin - startMin);
  const percent = Math.max(0, Math.min(100, Math.round((workedMin / targetMin) * 100)));
  const status = checkOut ? "OFF" : checkIn ? "IN" : "NONE";

  res.set("Cache-Control", "private, max-age=30");
  res.json({
    status,
    workedMin,
    targetMin,
    percent,
    checkIn: rec?.checkIn ?? null,
    checkOut: rec?.checkOut ?? null,
    startLabel: fmtHHmm(startMin),
    endLabel: fmtHHmm(endMin),
    generatedAt: new Date(now).toISOString(),
  });
});

export default router;
