/**
 * iOS App Store 업데이트 권장 모달.
 *
 * 동작:
 *  - AppLayout 마운트 시 + 앱이 백그라운드→포그라운드로 돌아올 때 checkAppStoreUpdate() 호출.
 *  - needsUpdate=true 이면 모달 표시. "지금 업데이트" → App Store 트랙 URL 외부 열림.
 *    "나중에" → 24시간 dismiss(localStorage 에 기록 — 같은 버전 다시 안 뜸).
 *  - 결과는 1시간 캐시 — 같은 세션 내 같은 모달이 반복적으로 뜨지 않게.
 *
 * 비 iOS(웹·데스크탑·안드)는 컴포넌트가 일찍 null 을 반환해 무영향.
 * 데스크탑 / 웹 업데이트는 기존 DesktopUpdateBanner / UpdateBanner 가 담당(별도 채널).
 */

import { useEffect, useState } from "react";
import Portal from "./Portal";
import { Browser } from "@capacitor/browser";
import { isCapacitorNative } from "../lib/platform";
import {
  checkAppStoreUpdate,
  dismissAppStoreUpdate,
  type AppStoreCheckResult,
} from "../lib/checkAppStoreUpdate";

export default function AppStoreUpdatePrompt() {
  const [result, setResult] = useState<AppStoreCheckResult | null>(null);
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!isCapacitorNative()) return; // iOS Capacitor 만 활성
    let alive = true;
    const run = async () => {
      try {
        const r = await checkAppStoreUpdate();
        if (!alive) return;
        setResult(r);
        if (r.needsUpdate) setOpen(true);
      } catch { /* silent */ }
    };
    // 초기 마운트 시 1회.
    void run();
    // 포그라운드 복귀 시 재체크 — 백그라운드 동안 새 버전이 배포됐을 수 있음.
    const onVis = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVis); };
  }, []);

  if (!open || !result?.needsUpdate) return null;

  const onUpdate = async () => {
    if (opening) return;
    setOpening(true);
    try {
      if (result.trackUrl) {
        // 외부 Safari 가 아닌 in-app Browser 로 App Store 페이지로 이동(앱 알림 X, 빠름).
        await Browser.open({ url: result.trackUrl, presentationStyle: "fullscreen" });
      }
    } catch { /* 사용자 취소·실패는 silent */ }
    finally { setOpening(false); }
  };
  const onLater = () => {
    if (result.latest) dismissAppStoreUpdate(result.latest);
    setOpen(false);
  };

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="앱 업데이트 권장"
        className="modal-safe fixed inset-0 z-[1100] grid place-items-center"
        style={{ background: "rgba(15,18,28,0.55)" }}
      >
        <div className="panel p-5 w-full max-w-[400px] flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="grid place-items-center rounded-2xl flex-shrink-0"
              style={{ width: 44, height: 44, background: "linear-gradient(135deg, #3B5CF0 0%, #7C3AED 100%)", color: "#fff" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-9 9c-2.39 0-4.68-.94-6.4-2.6L3 21" />
                <path d="M3 12a9 9 0 0 1 9-9c2.39 0 4.68.94 6.4 2.6L21 3" />
                <path d="M21 3v6h-6" /><path d="M3 21v-6h6" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15.5px] font-extrabold text-ink-900 leading-tight">
                새 버전이 있어요
              </div>
              <div className="text-[12.5px] text-ink-500 mt-1 leading-relaxed">
                App Store 에 최신 버전 <b className="text-ink-800">{result.latest}</b> 가
                올라왔어요. 더 나아진 기능과 안정성을 위해 업데이트를 권장해요.
              </div>
              {result.current && (
                <div className="text-[11px] text-ink-400 mt-1.5 tabular-nums">
                  현재 {result.current} → 최신 {result.latest}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={onLater}
              className="flex-1 h-11 rounded-[12px] font-bold text-[13.5px] text-ink-700 bg-[var(--c-surface-3)] active:scale-[0.98] transition"
            >
              나중에
            </button>
            <button
              type="button"
              onClick={onUpdate}
              disabled={opening || !result.trackUrl}
              className="flex-[1.4] h-11 rounded-[12px] font-extrabold text-[13.5px] text-white bg-brand-500 disabled:opacity-50 active:scale-[0.98] transition"
            >
              {opening ? "여는 중…" : "지금 업데이트"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
