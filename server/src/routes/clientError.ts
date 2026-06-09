import { Router } from "express";
import { pushErrorEvent } from "../lib/logBuffer.js";

/**
 * 클라이언트(브라우저·iOS/Android WebView·데스크톱) 런타임 에러 수집 → 운영 콘솔 "에러" 탭.
 *
 * 배경: 지금까지 클라 JS 에러는 서버로 전혀 보고되지 않아(window.onerror/unhandledrejection
 *   없음, ErrorBoundary 는 console.error 만) 콘솔 에러 탭엔 서버 5xx 만 떴다. 이 엔드포인트로
 *   클라 에러도 같은 인메모리 에러 버퍼(pushErrorEvent)에 들어가 콘솔에 노출된다.
 *
 * - 인증 불요(public): 로그인 화면 등 인증 이전 에러도 받아야 하므로. (req.user 가 있으면 첨부)
 * - 남용 방지: 전역 apiLimiter + 페이로드 크기 클램프 + 에러 버퍼 자체가 4000개 ring buffer.
 * - 메시지에 "[클라]" prefix 를 붙여 서버 5xx 와 구분.
 */
const router = Router();

router.post("/", (req, res) => {
  try {
    const b = (req.body ?? {}) as { message?: unknown; stack?: unknown; path?: unknown; userId?: unknown };
    const message = String(b.message ?? "").trim().slice(0, 1000);
    if (!message) return res.status(204).end();
    const stack = String(b.stack ?? "").slice(0, 4000);
    const path = String(b.path ?? "").slice(0, 300);
    // userId: 서버 세션(있으면) 우선, 없으면 클라가 보낸 값(진단용 best-effort).
    const userId = (req as any).user?.id ?? (b.userId ? String(b.userId).slice(0, 64) : null);
    pushErrorEvent({
      ts: Date.now(),
      status: 0, // HTTP 상태 아님(클라 런타임 에러) — 0 으로 구분.
      method: "CLIENT",
      path: path || (req.get("referer") ?? ""),
      message: "[클라] " + message,
      stack: stack || "(no stack)",
      userId,
      ua: req.get("user-agent") ?? null,
      ip: req.ip ?? null,
    });
  } catch {
    /* 진단 수집 실패는 조용히 무시 */
  }
  // 항상 204 — 클라 에러 리포팅이 실패 응답으로 또 에러를 유발하지 않도록.
  res.status(204).end();
});

export default router;
