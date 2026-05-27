/**
 * 사용자가 업로드한 파일/이미지/영상의 url 을 React `href`/`src` 에 그대로 박기 전
 * 한 번 더 검증한다. 서버 Zod 스키마에서 이미 막지만, 과거 데이터가 javascript:/data:
 * 스킴으로 들어와 있을 수 있고, 새 코드가 또 다른 사용자 입력을 href 에 쓰는 일이
 * 잦아 클라이언트에도 같은 정책을 박아둔다.
 *
 * 정책:
 *   FILE/IMAGE/VIDEO 첨부 → "/uploads/[A-Za-z0-9._-]+"  만 허용
 *   LINK 외부 링크          → http(s)://… 만 허용
 *
 * 어느 것에도 해당하지 않으면 null 반환 — 호출부는 링크 없는 텍스트로 fallback.
 */

const UPLOAD_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
const HTTP_RE = /^https?:\/\//i;

export function safeUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return UPLOAD_RE.test(url) ? url : null;
}

export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return HTTP_RE.test(url) ? url : null;
}

/** 첨부 종류에 따라 적절한 검증기를 골라준다. */
export function safeAttachmentUrl(
  url: string | null | undefined,
  kind: "FILE" | "IMAGE" | "VIDEO" | "LINK",
): string | null {
  return kind === "LINK" ? safeExternalUrl(url) : safeUploadUrl(url);
}
