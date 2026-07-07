/**
 * 공통 포맷 유틸 — 여러 컴포넌트에서 중복 선언되던 헬퍼들을 한 곳으로 모음.
 */

/** 바이트 수를 사람이 읽기 쉬운 문자열로 변환 (B / KB / MB / GB) */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 사용자 노출용 날짜 정규화 — API 가 풀 ISO(Prisma DateTime 직렬화, "2026-06-09T00:00:00.000Z")나
 * 임의 형식 문자열을 줘도 화면엔 YYYY-MM-DD 만. 개발용 타임스탬프가 사용자 화면에 새는 것 방지.
 * YYYY-MM-DD 시작이면 앞 10자, 아니면 Date 파싱 성공 시 로컬 기준 YYYY-MM-DD, 실패 시 원문 유지.
 */
export function fmtYmd(s?: string | null, fallback = "—"): string {
  if (!s) return fallback;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
