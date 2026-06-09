/**
 * 회사별 숨김 직급 이름 목록.
 *
 * Position.hidden=true 인 직급에 속한 사용자는 디렉터리·조직도·픽커 등 모든 사용자 목록
 * API 에서 제외된다(본인은 자기 정보 정상 조회 가능). 회사당 직급 수가 보통 ~10개라 매번
 * 조회해도 가벼우나, 사용자 목록 API 가 매 요청 호출되는 핫패스라 30초 메모리 캐시.
 *
 * 사용 예:
 *   const hidden = await getHiddenPositions(u.companyId);
 *   prisma.user.findMany({
 *     where: { ...baseWhere, ...excludeHidden(hidden, { exceptId: u.id }) },
 *   });
 *
 * 멀티 인스턴스(Fargate 확장) 환경에서도 안전 — 각 인스턴스가 자기 캐시를 가지고 TTL 안에
 * 동기화. 30초 stale 은 직급 토글 즉시반영 측면에서 허용 범위.
 */

import { prisma } from "./db.js";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; names: string[] }>();

/** 회사의 숨김 직급 이름 배열. 캐시 hit 시 즉시 반환. */
export async function getHiddenPositions(companyId: string | null | undefined): Promise<string[]> {
  const key = companyId ?? "__null__";
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.names;
  const rows = await prisma.position.findMany({
    where: { companyId: companyId ?? null, hidden: true },
    select: { name: true },
  });
  const names = rows.map((r) => r.name);
  cache.set(key, { at: now, names });
  return names;
}

/** 회사 캐시 무효화 — Position 의 hidden 토글 시 즉시 반영. */
export function evictHiddenPositions(companyId: string | null | undefined): void {
  cache.delete(companyId ?? "__null__");
}

/**
 * Prisma where 조각 — 숨김 직급 사용자 제외.
 * - exceptId 지정 시 그 사용자 본인은 항상 포함(본인이 자기 자신을 picker 에서 보거나
 *   본인 정보 API 가 영향받지 않게).
 * - hidden 직급이 없으면 빈 객체 반환 → spread 해도 무영향.
 */
export function excludeHidden(
  hiddenNames: string[],
  opts?: { exceptId?: string | null },
): Record<string, unknown> {
  if (hiddenNames.length === 0) return {};
  const notInHidden = { position: { notIn: hiddenNames } };
  if (opts?.exceptId) {
    return { OR: [notInHidden, { id: opts.exceptId }] };
  }
  return notInHidden;
}
