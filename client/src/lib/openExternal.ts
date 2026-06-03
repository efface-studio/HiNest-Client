import { Browser } from "@capacitor/browser";
import { isCapacitorNative, isDesktopApp } from "./platform";

/**
 * 외부(타사) 웹 링크 열기.
 *
 * 환경별 동작:
 *  - Electron 데스크톱: 기존 네이티브 셸 브리지(window.hinest.openExternal)로 시스템 브라우저.
 *  - Capacitor 네이티브(iOS/Android): 인앱 브라우저(SFSafariViewController / Custom Tab).
 *    그냥 <a target="_blank"> 면 WKWebView 안에서 열려 뒤로가기 없이 갇히므로 반드시 이걸 쓴다.
 *  - 웹 브라우저: 새 탭(noopener,noreferrer).
 *
 * 외부 링크 전용이다. 앱 내부 파일(/uploads)은 lib/download.ts 의 downloadFromUrl 을 쓸 것.
 */
export function openExternal(url: string | null | undefined): void {
  if (!url) return;
  if (typeof window !== "undefined" && isDesktopApp() && window.hinest?.openExternal) {
    window.hinest.openExternal(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
    return;
  }
  if (isCapacitorNative()) {
    void Browser.open({ url }).catch(() => {});
    return;
  }
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
