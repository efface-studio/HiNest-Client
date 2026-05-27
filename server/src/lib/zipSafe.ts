/**
 * archiver 로 ZIP 을 만들 때 entry name 을 안전하게 정규화한다.
 *
 * 문제 (ZIP slip):
 *   document.fileName / document.title / folder.name 같은 사용자 입력이
 *   ZIP 내부 path 로 들어가는데, 거기에 "../" 가 섞이면 추출 시
 *   상위 디렉토리에 파일이 생긴다.
 *
 * 정책:
 *   - 각 segment 의 ".." / "." 제거
 *   - 경로 구분자(`/`, `\`)는 segment 단위로 분리해서 처리
 *   - 절대경로 prefix(`/`, `C:\`) 제거
 *   - segment 가 비면 "_" 로 대체
 *   - segment 별로 200자 캡 (윈도우 NTFS 호환)
 *
 *   sanitizeZipPath("../../etc/passwd")          → "etc/passwd"
 *   sanitizeZipPath("a/../../../b")              → "a/b"
 *   sanitizeZipPath("a/b/../c")                  → "a/c"
 *   sanitizeZipPath("/leading/slash")            → "leading/slash"
 *   sanitizeZipPath("C:\\Windows\\System32")     → "C/Windows/System32"
 *   sanitizeZipPath("")                          → "_"
 */
export function sanitizeZipPath(p: string): string {
  if (!p) return "_";
  // 통합 구분자
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const out: string[] = [];
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;          // 빈 segment (`//` 등) 무시
    if (s === ".") continue;
    if (s === "..") continue;  // 상위 이동 제거
    // 윈도우 드라이브 prefix (C:) → "C"
    const cleaned = s
      .replace(/^([A-Za-z]):$/, "$1")
      // OS 예약 문자 일부 정리 — 이름이 깨지진 않도록 underscore 로
      .replace(/[\x00-\x1f<>"|?*]/g, "_")
      .slice(0, 200);
    out.push(cleaned || "_");
  }
  return out.length ? out.join("/") : "_";
}

/**
 * ZIP 한 회의 entry name 들이 unique 하도록 collide 시 "(2)", "(3)" 접미.
 *   기존 코드의 uniqueName() 와 동일 의도 — but path traversal 방어가 추가됨.
 */
export function safeUniqueZipEntry(
  takenSet: Set<string>,
  relPath: string,
  fileName: string,
): string {
  const dir = sanitizeZipPath(relPath || "");
  const base = sanitizeZipPath(fileName || "file");
  const joined = dir && dir !== "_" ? `${dir}/${base}` : base;
  if (!takenSet.has(joined)) {
    takenSet.add(joined);
    return joined;
  }
  // 확장자 분리 후 (2), (3) ...
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let i = 2; i < 1000; i++) {
    const candidate = dir && dir !== "_"
      ? `${dir}/${stem} (${i})${ext}`
      : `${stem} (${i})${ext}`;
    if (!takenSet.has(candidate)) {
      takenSet.add(candidate);
      return candidate;
    }
  }
  // 비현실적인 충돌 — 안전을 위해 cuid 비슷한 suffix
  const fallback = `${stem}-${Date.now().toString(36)}${ext}`;
  takenSet.add(fallback);
  return fallback;
}
