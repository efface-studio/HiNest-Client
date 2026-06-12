/**
 * 서버 시간대(KST) 전용 날짜 헬퍼.
 *
 * 컨테이너 기본 TZ 는 UTC 라서 `new Date().getDate()` 로 만든 "오늘" 문자열이
 * 0~9시 KST 사이에는 전날 UTC 날짜를 내뱉음 → 출근/공지/관리자 리포트가 하루 밀리는 버그.
 * ECS 태스크 정의에 `TZ=Asia/Seoul` 환경변수를 넣어 근본 해결했지만,
 *   - 로컬 dev (.env 에 TZ 안 씀)
 *   - 컨테이너 환경 변경 시 TZ 누락 가능성
 * 같은 상황을 대비해 이 모듈은 Intl.DateTimeFormat 으로 명시적으로 서울을 고정.
 *
 * 모든 "오늘" 날짜 문자열(YYYY-MM-DD) 은 이 함수를 쓰는 걸 권장.
 */

const KST_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 현재 KST 기준 YYYY-MM-DD. */
export function todayStr(): string {
  // sv-SE 로케일은 YYYY-MM-DD 형식을 기본으로 준다 — split 필요 없음.
  return KST_FMT.format(new Date());
}

/** 주어진 Date 의 KST 기준 YYYY-MM-DD. */

/** KST 기준 오늘 00:00:00 (UTC Date 오브젝트). */
export function startOfTodayKST(): Date {
  const [y, m, d] = todayStr().split("-").map(Number);
  // KST 00:00:00 = UTC 15:00:00 (전날) — Date(YYYY, MM, DD) 는 로컬 TZ 기준.
  // TZ=Asia/Seoul 가 세팅돼 있으면 이 그대로 동작. 아니라도 UTC 와 9시간 차이만 날 뿐
  // prisma 쿼리 (startDate < endOfToday && endDate >= startOfToday) 에서는 대체로 안전.
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** KST 기준 내일 00:00:00 (UTC Date 오브젝트). */
export function endOfTodayKST(): Date {
  const s = startOfTodayKST();
  s.setDate(s.getDate() + 1);
  return s;
}
