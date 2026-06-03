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
 * URL 을 파일로 다운로드.
 * 동일 출처거나 서버가 `Content-Disposition: attachment` 를 주는 URL 에 사용.
 *
 * @param filename `download` 속성값. 빈 문자열이어도 동일 출처 다운로드를 강제하며,
 *   이 경우 브라우저가 서버의 Content-Disposition 파일명으로 폴백한다.
 */
export function downloadFromUrl(href: string, filename = ""): void {
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
