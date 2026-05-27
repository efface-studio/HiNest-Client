import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

/**
 * 사이드바 뱃지용 카운트 엔드포인트.
 * 클라이언트가 각 키 별 "마지막으로 본 시각(since)" 을 localStorage 에 보관 후
 * 쿼리스트링으로 넘기면, 해당 시각 이후 새로 생긴 항목 수를 반환.
 *
 *   GET /api/nav/counts?since_schedule=ISO&since_notice=ISO&...
 */
const router = Router();
router.use(requireAuth);

// ─── /api/nav/visibility 인메모리 캐시 ───────────────────────────────────────
// NavConfig 는 관리자가 수동으로 바꾸는 아주 드문 데이터이지만
// /visibility 는 모든 사용자의 모든 페이지 로드마다 호출된다.
// 1분 TTL 캐시로 DB 왕복을 없애고, 변경 시 admin 라우트에서 즉시 무효화.
type NavVisibilityPayload = { disabled: string[]; dev: string[] };
let _navVisCache: { data: NavVisibilityPayload; exp: number } | null = null;
const NAV_VIS_TTL_MS = 60_000; // 1분

export function evictNavVisibilityCache(): void {
  _navVisCache = null;
}

async function getNavVisibility(): Promise<NavVisibilityPayload> {
  if (_navVisCache && _navVisCache.exp > Date.now()) return _navVisCache.data;
  const rows = await prisma.navConfig.findMany({
    select: { path: true, enabled: true, inDev: true },
  });
  const disabled = rows.filter((r) => !r.enabled).map((r) => r.path);
  const dev = rows.filter((r) => r.enabled && r.inDev).map((r) => r.path);
  const data = { disabled, dev };
  _navVisCache = { data, exp: Date.now() + NAV_VIS_TTL_MS };
  return data;
}

/** 사이드바 메뉴 상태:
 *  - disabled: 사이드바에서 숨김 + 라우트 차단 (enabled=false 인 path)
 *  - dev:       사이드바엔 노출하되 진입 시 "개발 중" 안내 (enabled=true && inDev=true)
 *  행이 없는 path 는 기본 enabled=true / inDev=false 로 간주 — 클라는 두 set 만 알면 됨. */
router.get("/visibility", async (_req, res) => {
  const data = await getNavVisibility();
  // 1분 private 캐시 + 30초 stale-while-revalidate — 캐시 미스 시 백그라운드 갱신.
  // 어드민이 변경 시 evictNavVisibilityCache() 로 즉시 무효화되므로 1분 이상 지연 없음.
  res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=30");
  res.json(data);
});

function parseSince(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

router.get("/counts", async (req, res) => {
  const u = (req as any).user;
  const q = req.query as Record<string, string | undefined>;

  const sinceSchedule  = parseSince(q.since_schedule);
  const sinceNotice    = parseSince(q.since_notice);
  const sinceDirectory = parseSince(q.since_directory);
  const sinceDocuments = parseSince(q.since_documents);
  const sinceExpense   = parseSince(q.since_expense);
  const sinceAttendance = parseSince(q.since_attendance);

  const isReviewer = u.role === "ADMIN" || u.role === "MANAGER";

  const [
    scheduleCount,
    noticeCount,
    directoryCount,
    documentsCount,
    approvalPendingCount,
    expenseCount,
    leaveCount,
    inviteCount,
  ] = await Promise.all([
    sinceSchedule
      ? prisma.event.count({ where: { createdAt: { gt: sinceSchedule } } })
      : Promise.resolve(0),

    sinceNotice
      ? prisma.notice.count({ where: { createdAt: { gt: sinceNotice } } })
      : Promise.resolve(0),

    sinceDirectory
      ? prisma.user.count({ where: { createdAt: { gt: sinceDirectory }, active: true } })
      : Promise.resolve(0),

    sinceDocuments
      ? prisma.document.count({ where: { createdAt: { gt: sinceDocuments } } })
      : Promise.resolve(0),

    // 전자결재 — 내가 검토해야 하는 대기중 step 수
    prisma.approvalStep.count({
      where: {
        reviewerId: u.id,
        status: "PENDING",
      },
    }),

    // 법인카드 — 리뷰어면 대기중 지출, 아니면 최근 등록 수
    isReviewer
      ? prisma.cardExpense.count({ where: { status: "PENDING" } })
      : sinceExpense
        ? prisma.cardExpense.count({ where: { userId: u.id, createdAt: { gt: sinceExpense } } })
        : Promise.resolve(0),

    // 근태·월차 — 리뷰어면 대기중 휴가 신청, 아니면 내 대기/변경
    isReviewer
      ? prisma.leave.count({ where: { status: "PENDING" } })
      : sinceAttendance
        ? prisma.leave.count({
            where: { userId: u.id, status: { in: ["APPROVED", "REJECTED"] }, createdAt: { gt: sinceAttendance } },
          })
        : Promise.resolve(0),

    // 관리자 — ADMIN 만, 사용 안 된 초대키 수
    u.role === "ADMIN"
      ? prisma.inviteKey.count({ where: { used: false } })
      : Promise.resolve(0),
  ]);

  // 30초 캐시 — 뱃지 숫자가 30초 늦게 반영돼도 사용성 영향 없음.
  // SSE 로 실시간 알림은 이미 처리됨.
  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  res.json({
    counts: {
      schedule: scheduleCount,
      attendance: leaveCount,
      approvals: approvalPendingCount,
      notice: noticeCount,
      directory: directoryCount,
      documents: documentsCount,
      expense: expenseCount,
      admin: inviteCount,
    },
  });
});

export default router;
