/**
 * 운영 콘솔 공용 상대시간 — "방금 / N분 전 / N시간 전 / N일 전".
 * epoch millis(ms)를 받는다. ISO 문자열이면 호출부에서 new Date(iso).getTime() 으로 넘긴다.
 * (ErrorsPanel·SessionsPanel 에 중복돼 있던 동일 구현을 한 곳으로 모음.)
 */
export function relTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}
