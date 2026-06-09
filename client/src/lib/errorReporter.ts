import { apiUrl } from "../api";

/**
 * 클라이언트 런타임 에러를 서버(/api/client-error)로 보고 → 운영 콘솔 "에러" 탭에 노출.
 *
 * 지금까지 클라 JS 에러는 서버로 전혀 전달되지 않아 콘솔 에러 탭엔 서버 5xx 만 떴다.
 * main.tsx 의 window error/unhandledrejection 핸들러와 ErrorBoundary 가 이 함수를 호출한다.
 *
 * 폭주 방지: 10초 창에서 최대 5건만 전송(에러 핸들러가 또 에러를 유발하는 루프 차단).
 */
let _windowStart = 0;
let _count = 0;

export function reportClientError(message: string, stack?: string): void {
  try {
    const now = Date.now();
    if (now - _windowStart > 10_000) {
      _windowStart = now;
      _count = 0;
    }
    if (_count >= 5) return;
    _count++;
    const body = JSON.stringify({
      message: String(message ?? "").slice(0, 1000),
      stack: String(stack ?? "").slice(0, 4000),
      path: typeof location !== "undefined" ? location.pathname + location.search : "",
    });
    // keepalive: 언로드 직전 에러도 전송 보장. 공개 엔드포인트라 인증 불요.
    void fetch(apiUrl("/api/client-error"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 리포팅 실패는 조용히 무시(절대 throw 금지 — 또 에러 유발 방지) */
  }
}
