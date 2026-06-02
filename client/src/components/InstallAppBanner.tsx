import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isInstalledApp } from "../lib/platform";

/**
 * 대시보드 상단에 1회 노출되는 "앱으로 쓰세요" 배너.
 *
 * 표시 조건:
 *  - 이미 설치형 앱 안이 아님 — 데스크톱(Electron) "또는" Capacitor 네이티브(iOS/Android).
 *    네이티브 앱 안에서 "앱 다운로드" 를 권하는 건 말이 안 되므로 isInstalledApp() 로 숨긴다.
 *  - PWA standalone 으로 실행 중이 아님 (홈 화면에서 띄운 것 아님)
 *  - 이전에 사용자가 닫지 않았음 (localStorage 키로 관리)
 *
 * 닫기는 영구적 (다시 보고 싶으면 localStorage 로 초기화). "나중에" 대신 "닫기" 한 번.
 * 이유: 개요 페이지는 매일 보는 곳이라 반복해서 뜨면 피곤해짐.
 */

const DISMISS_KEY = "hinest.installBanner.dismissed";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    (navigator as any).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches
  );
}

function detectPlatformLabel(): string {
  if (typeof navigator === "undefined") return "앱";
  const ua = navigator.userAgent || "";
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  if (/iPhone|iPod/.test(ua) || isIPad) return "iPhone · iPad 홈 화면에 추가";
  if (/Android/i.test(ua)) return "Android 앱 설치";
  if (/Mac/i.test(navigator.platform) || /Mac OS X/i.test(ua)) return "macOS 데스크톱 앱";
  if (/Win/i.test(navigator.platform) || /Windows/i.test(ua)) return "Windows 데스크톱 앱";
  return "데스크톱 · 모바일 앱";
}

export default function InstallAppBanner() {
  const installedApp = isInstalledApp();
  const standalone = useMemo(() => isStandalone(), []);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (installedApp || standalone || dismissed) return null;

  const label = detectPlatformLabel();

  function close() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setDismissed(true);
  }

  return (
    <div
      className="mb-5 panel p-4 flex items-center gap-3 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(59,92,240,0.06), rgba(59,92,240,0.02))",
        borderColor: "rgba(59,92,240,0.25)",
      }}
    >
      <div
        className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0"
        style={{ background: "var(--c-brand)", color: "var(--c-brand-fg)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-extrabold text-ink-900">
          HiNest 를 앱으로도 쓸 수 있어요
        </div>
        <div className="text-[11.5px] text-ink-600 mt-0.5 truncate">
          {label} · 알림·단축키·홈 화면 바로가기까지
        </div>
      </div>
      <Link to="/download" className="btn-primary btn-xs flex-shrink-0">
        다운로드
      </Link>
      <button
        onClick={close}
        className="btn-icon flex-shrink-0"
        title="닫기"
        aria-label="닫기"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
