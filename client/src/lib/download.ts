import { Browser } from "@capacitor/browser";
import { isCapacitorNative } from "./platform";
import { imgSrc } from "../api";

/**
 * 크로스 브라우저 파일 다운로드 트리거.
 *
 * 왜 이 헬퍼가 필요한가 (= "크롬은 되는데 엣지는 안 됨" 의 원인):
 *   기존 코드 곳곳이 `a.click()` 직후 **동기적으로** `a.remove()` / `URL.revokeObjectURL()`
 *   를 호출했다. Chrome 은 click 시점에 다운로드를 즉시 가로채 처리해서 문제가 없지만,
 *   Microsoft Edge·Firefox 의 다운로드 매니저는 엘리먼트/blob 을 **약간 늦게** 참조한다.
 *   그 사이에 앵커가 제거되거나 objectURL 이 해제되면 다운로드가 **조용히 취소**된다.
 *   → 같은 Chromium 이라도 Edge 에서만 다운로드가 안 되는 전형적 패턴.
 *
 * 해결:
 *   - 제거/해제를 동기 블록이 아니라 다음 매크로태스크(setTimeout)로 미룬다.
 *   - objectURL 은 다운로드가 시작될 충분한 시간을 준 뒤에만 해제한다.
 *   - `target="_blank"` 를 쓰지 않는다. Content-Disposition: attachment 응답은 새 탭 없이도
 *     현재 페이지를 navigate 시키지 않고 다운로드로 떨어진다. `_blank` 는 빈 탭·팝업 차단
 *     문제만 만든다(특히 Edge).
 */

/**
 * /uploads 파일 URL 에 원본 파일명 힌트(?name=)를 붙인다.
 *
 * 왜 필요한가 — 서버(/uploads)는 `?name=` 이 없으면 **스토리지 키(해시)** 를 파일명으로 써서
 * Content-Disposition 을 만든다. 그리고 다운로드는 S3 presigned 로 302 되므로 **cross-origin
 * 이 되는 순간 `<a download>` 의 파일명은 브라우저가 무시하고 서버가 만든 Content-Disposition
 * 만 남는다**(Chrome·Edge·Safari·Firefox / Windows·macOS·모바일 공통). 즉 이 힌트가 전 플랫폼에서
 * 원본 파일명을 지키는 유일한 수단이다. 호출부마다 빼먹지 않도록 여기 한 곳에서 붙인다.
 *
 * 외부(http…)·blob·data URL 과 /uploads 가 아닌 경로는 그대로 둔다.
 */
export function uploadUrlWithName(
  href: string,
  filename?: string | null,
  opts: { download?: boolean } = {},
): string {
  if (!href || /^(data:|blob:)/i.test(href)) return href;
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const u = new URL(href, origin);
    if (!u.pathname.startsWith("/uploads/")) return href;
    if (opts.download) u.searchParams.set("download", "1");
    if (filename) u.searchParams.set("name", filename);
    // 상대경로로 들어온 건 상대경로로 유지(imgSrc 가 절대화·토큰 부착을 담당).
    return href.startsWith("/") ? u.pathname + u.search : u.toString();
  } catch {
    return href;
  }
}

/**
 * URL 을 파일로 다운로드.
 * 동일 출처거나 서버가 `Content-Disposition: attachment` 를 주는 URL 에 사용.
 *
 * @param filename `download` 속성값. 빈 문자열이어도 동일 출처 다운로드를 강제하며,
 *   이 경우 브라우저가 서버의 Content-Disposition 파일명으로 폴백한다.
 */
export function downloadFromUrl(href: string, filename = ""): void {
  // /uploads 파일이면 원본명 힌트를 URL 에 실어 서버가 올바른 Content-Disposition 을 만들게 한다
  // (S3 presigned 302 로 넘어가면 아래 `a.download` 는 무시되므로 이게 유일한 파일명 보장 수단).
  href = uploadUrlWithName(href, filename, { download: true });
  // 데스크탑(Electron): 메인 프로세스가 webContents.downloadURL 로 직접 받게 한다.
  //   <a download> 는 cross-origin 302(/uploads → S3 presigned) 에서 download 속성·파일명이
  //   무시되고, 리다이렉트 추적 중 창 네비게이션 edge case 로 "안 받아지거나 느린" 현상이 있었다.
  //   IPC 로 넘기면 will-download 가 단번에 떠 ?name= 으로 원본 파일명을 강제하고 즉시 저장된다.
  //   (will-download 핸들러는 getURLChain 으로 리다이렉트 전 ?name= 까지 읽는다.)
  const hinest = (window as any).hinest;
  if (hinest?.downloadFile) {
    try {
      const abs = new URL(href, window.location.origin).toString();
      hinest.downloadFile(abs);
      return;
    } catch { /* IPC 실패 시 아래 <a download> 폴백 */ }
  }
  // 네이티브 앱(Capacitor WKWebView)은 <a download> 로 파일을 저장하지 못한다.
  // 인증된 절대 URL 을 인앱 브라우저(SFSafariViewController)로 열어 iOS 가 미리보기 +
  // 공유/저장 시트를 제공하게 한다. imgSrc 가 /uploads 상대경로를 절대화하고 ?token= 을 붙인다.
  if (isCapacitorNative()) {
    const url = imgSrc(href) ?? href;
    void Browser.open({ url }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // 동기 제거 금지 — 다음 틱에 정리해야 Edge/Firefox 가 다운로드를 취소하지 않음.
  setTimeout(() => a.remove(), 0);
}

/**
 * Blob 을 파일로 저장. objectURL 은 다운로드가 시작될 시간을 충분히 준 뒤 해제(메모리 누수 방지).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  downloadFromUrl(href, filename);
  // 즉시 revoke 하면 다운로드가 취소될 수 있어 넉넉히 지연 후 해제.
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
