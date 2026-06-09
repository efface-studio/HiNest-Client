import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

/**
 * 사이드바 메뉴 노출 상태 엔드포인트.
 *
 *   GET /api/nav/visibility — { disabled: string[], dev: string[] }
 *
 * (예전의 GET /api/nav/counts 뱃지 카운트 엔드포인트는 클라이언트 호출처가 사라져
 *  죽은 코드였으므로 제거했다 — 결재 카운트는 /api/approval/counts, 그 외 신규 알림은
 *  알림 SSE 가 담당.)
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

export default router;
