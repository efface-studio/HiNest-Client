import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * 결재 대기 / 내 미결 개수 — 사이드바 배지 + 탭 표시용.
 *
 * 비용 절감:
 *   - 폴링 주기 15초 → 60초. 사내 결재는 분 단위 SLA 가 충분.
 *   - 탭이 hidden 인 동안은 폴링 정지(setInterval clear). 다시 visible 이 되면 즉시 한 번 load 하고
 *     interval 재무장. 백그라운드 탭 수십 개에서 매분 4회씩 누적되던 요청을 0회로.
 *   - 결재 화면이 처리 직후 dispatch 하는 hinest:approvalCountsRefresh 이벤트는 그대로 사용.
 */
export function useApprovalCounts() {
  const [counts, setCounts] = useState<{ pending: number; mine: number }>({ pending: 0, mine: 0 });

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    async function load() {
      try {
        const r = await api<{ pending: number; mine: number }>("/api/approval/counts");
        if (alive) setCounts(r);
      } catch { /* 401 등은 무시 */ }
    }
    function startTimer() {
      if (timer !== null) return;
      timer = window.setInterval(load, 60_000);
    }
    function stopTimer() {
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    }
    load();
    if (document.visibilityState === "visible") startTimer();
    function onVis() {
      if (document.visibilityState === "visible") { load(); startTimer(); }
      else { stopTimer(); }
    }
    function onSignal() { load(); }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("hinest:approvalCountsRefresh", onSignal);
    return () => {
      alive = false;
      stopTimer();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("hinest:approvalCountsRefresh", onSignal);
    };
  }, []);

  return counts;
}

/** 결재 화면이 처리 후 카운트 즉시 갱신을 트리거할 때 사용. */
export function refreshApprovalCounts() {
  window.dispatchEvent(new Event("hinest:approvalCountsRefresh"));
}
