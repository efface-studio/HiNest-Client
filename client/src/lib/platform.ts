/**
 * 런타임 플랫폼 감지 — 같은 웹 번들이 ① 일반 브라우저 ② Electron 데스크톱
 * (window.hinest) ③ Capacitor 네이티브 앱(window.Capacitor) 어디서 도는지 구분.
 *
 * @capacitor/core 를 import 하지 않고 런타임 전역만 본다 — 웹/데스크톱 빌드가
 * 네이티브 패키지에 의존하지 않게(번들 가벼움 + 빌드 단순). Capacitor 가 네이티브
 * WebView 에 주입하는 window.Capacitor 전역으로 충분히 판별된다.
 */
export function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  return window.Capacitor?.isNativePlatform?.() === true;
}

/** "ios" | "android" | "web" — 네이티브가 아니면 "web". */
export function nativePlatform(): "ios" | "android" | "web" {
  if (typeof window === "undefined") return "web";
  const p = window.Capacitor?.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
}

/** Electron 데스크톱 셸 여부 — 기존 window.hinest 브리지로 판별. */
export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.hinest?.isDesktop === true;
}

/** 네이티브 앱(데스크톱 or 모바일) 안에서 도는지 — "앱 다운로드" 안내 숨김 등에 사용. */
export function isInstalledApp(): boolean {
  return isDesktopApp() || isCapacitorNative();
}
