import { useSyncExternalStore } from "react";
import { api } from "../api";

/**
 * 결재 대기 / 내 미결 개수 — 사이드바 배지 + 하단탭 배지용.
 *
 * ⚠️ 모듈 싱글톤(공유 구독) 설계 — 비용 절감 핵심:
 *   레이아웃은 데스크톱 사이드바(NavSection ×3)와 모바일 BottomNav 를 **항상 함께 마운트**하고
 *   CSS(md:flex / md:hidden)로 한쪽만 보여준다. 예전엔 각 컴포넌트가 useApprovalCounts 를
 *   호출해 **각자 60초 setInterval** 을 돌려 사용자당 ~4req/min 으로 /api/approval/counts(2쿼리)
 *   를 때렸다. 이제 폴링 타이머·리스너·in-flight 를 모듈 레벨에 하나만 두고, 모든 컴포넌트는
 *   useSyncExternalStore 로 같은 값을 구독한다 → 첫 구독자에서 1세트만 무장, 마지막 해제 시 정지.
 *   동일한 신선도(60초 + 포커스 복귀 즉시 + hinest:approvalCountsRefresh 이벤트)·UX·지연을 그대로
 *   유지하면서 요청 수만 ~75% 감소.
 */

type Counts = { pending: number; mine: number };

let _counts: Counts = { pending: 0, mine: 0 };
const _listeners = new Set<() => void>();
let _refCount = 0;
let _timer: number | null = null;
let _inFlight = false;

function emit() {
  for (const l of _listeners) l();
}

async function load() {
  if (_inFlight) return; // 동시 중복 요청 방지(여러 트리거가 겹쳐도 1회)
  _inFlight = true;
  try {
    const r = await api<Counts>("/api/approval/counts");
    // 값이 바뀐 경우에만 새 객체로 교체 → getSnapshot 참조 안정성(불필요한 리렌더 방지).
    if (r && (r.pending !== _counts.pending || r.mine !== _counts.mine)) {
      _counts = { pending: r.pending, mine: r.mine };
      emit();
    }
  } catch {
    /* 401 등은 무시 */
  } finally {
    _inFlight = false;
  }
}

function startTimer() {
  if (_timer === null) _timer = window.setInterval(() => void load(), 60_000);
}
function stopTimer() {
  if (_timer !== null) {
    window.clearInterval(_timer);
    _timer = null;
  }
}
function onVis() {
  if (document.visibilityState === "visible") {
    void load();
    startTimer();
  } else {
    stopTimer(); // 탭 숨김 동안 폴링 정지
  }
}
function onSignal() {
  void load();
}

function activate() {
  // 첫 구독자에서만 폴링/리스너 1세트 무장.
  void load();
  if (document.visibilityState === "visible") startTimer();
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("hinest:approvalCountsRefresh", onSignal);
}
function deactivate() {
  stopTimer();
  document.removeEventListener("visibilitychange", onVis);
  window.removeEventListener("hinest:approvalCountsRefresh", onSignal);
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  if (_refCount === 0) activate();
  _refCount++;
  return () => {
    _listeners.delete(cb);
    _refCount = Math.max(0, _refCount - 1);
    if (_refCount === 0) deactivate();
  };
}
function getSnapshot(): Counts {
  return _counts;
}

export function useApprovalCounts(): Counts {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 결재 화면이 처리 후 카운트 즉시 갱신을 트리거할 때 사용. */
export function refreshApprovalCounts() {
  window.dispatchEvent(new Event("hinest:approvalCountsRefresh"));
}
