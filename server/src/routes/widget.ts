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

const router = Router();
router.use(requireAuth);

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

export default router;
