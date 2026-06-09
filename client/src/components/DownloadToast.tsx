/**
 * 글로벌 다운로드 토스트 — 하단 중앙 알약(pill) 형태로 "다운로드 준비/진행" 을 알린다.
 *
 * 왜 버튼 스피너가 아니라 토스트인가:
 *   버튼별 스피너는 데스크탑(테이블/호버 액션)에선 보이지만, 모바일은 문서 카드 탭으로 바로
 *   다운로드돼 스피너를 띄울 버튼이 없고, 네이티브(iOS)는 인앱 브라우저로 빠져 앱 내 표시가
 *   없다 → 모바일에서 "눌러도 아무 반응 없는" 느낌. 토스트는 웹·모바일·네이티브 어디서나
 *   동일하게 화면 하단에 뜬다(플랫폼 무관). safe-area·탭바 위로 올라오게 배치.
 *
 * 사용:
 *   const id = showDownloadToast("📦 압축 파일 준비 중…", { spinner: true });
 *   ...완료...
 *   hideDownloadToast(id);                       // 특정 토스트 닫기
 *   showDownloadToast("다운로드를 시작했어요", { autoHideMs: 2000 }); // 자동 닫힘
 */
import { useEffect, useState } from "react";
import Portal from "./Portal";

type ToastState = { id: number; text: string; spinner: boolean } | null;

let _seq = 1;
let _current: ToastState = null;
const _listeners = new Set<(s: ToastState) => void>();
function _emit() { _listeners.forEach((fn) => fn(_current)); }

/** 토스트 표시(또는 교체). 반환된 id 로 나중에 hide. autoHideMs 주면 그 시간 뒤 자동 닫힘. */
export function showDownloadToast(
  text: string,
  opts: { spinner?: boolean; autoHideMs?: number } = {},
): number {
  const id = _seq++;
  _current = { id, text, spinner: opts.spinner ?? false };
  _emit();
  if (opts.autoHideMs && opts.autoHideMs > 0) {
    setTimeout(() => hideDownloadToast(id), opts.autoHideMs);
  }
  return id;
}

/** 토스트 닫기 — id 가 지금 떠 있는 토스트와 같을 때만(다른 토스트로 교체됐으면 무시). */
export function hideDownloadToast(id?: number): void {
  if (id != null && _current?.id !== id) return;
  _current = null;
  _emit();
}

export default function DownloadToastHost() {
  const [state, setState] = useState<ToastState>(_current);
  useEffect(() => {
    const fn = (s: ToastState) => setState(s);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);

  return (
    <Portal>
      <div
        aria-live="polite"
        className="fixed inset-x-0 z-[1200] flex justify-center pointer-events-none px-4"
        style={{
          // 모바일 하단 탭바·홈 인디케이터 위로 — safe-area + 여유. 데스크탑은 env=0 이라 하단에서 24px.
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)",
        }}
      >
        <div
          className="flex items-center gap-2.5 rounded-full bg-ink-900/92 text-white text-[13px] font-semibold px-4 py-2.5 shadow-2xl backdrop-blur-sm"
          style={{
            transform: state ? "translateY(0)" : "translateY(16px)",
            opacity: state ? 1 : 0,
            transition: "transform 240ms cubic-bezier(.32,.72,0,1), opacity 200ms ease",
            pointerEvents: state ? "auto" : "none",
            maxWidth: "90vw",
          }}
        >
          {state?.spinner && (
            <svg className="hinest-spin flex-shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-6.2-8.5" />
            </svg>
          )}
          <span className="truncate">{state?.text ?? ""}</span>
        </div>
      </div>
    </Portal>
  );
}
