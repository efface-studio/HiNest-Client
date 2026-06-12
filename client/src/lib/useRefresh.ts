import { useState } from "react";

/**
 * 페이지 새로고침 공통 훅 — `refreshing` 플래그 + `refresh()` 래퍼.
 *
 * 여러 페이지에 동일하게 복제돼 있던 패턴
 *   const [refreshing, setRefreshing] = useState(false);
 *   async function refresh() { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }
 * 을 한 곳으로 모은 것. `fn` 에 데이터 로더(load / reload / Promise.all(...) 등)를 그대로 넘긴다.
 * 동작은 기존과 동일 — refresh 호출 동안 refreshing=true, 끝나면(성공/실패 무관) false.
 */
export function useRefresh(fn: () => Promise<unknown>): { refreshing: boolean; refresh: () => Promise<void> } {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await fn();
    } finally {
      setRefreshing(false);
    }
  };
  return { refreshing, refresh };
}
