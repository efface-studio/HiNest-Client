/**
 * 한국 공휴일 / 법정 대체공휴일 데이터 (2025–2030).
 * 음력 기반 공휴일은 매년 날짜가 달라 직접 데이터로 유지합니다.
 * 대체공휴일은 아래 공식 규칙을 반영해 미리 계산됐습니다.
 *
 * 대체공휴일이 적용되는 공휴일 (공휴일법 시행령):
 *  - 삼일절, 어린이날, 부처님오신날, 광복절, 개천절, 한글날, 성탄절
 *    → 일요일/다른 공휴일과 겹치면 '다음 평일'
 *  - 설날, 추석 3일 연휴 → 일요일/다른 공휴일과 겹치면 '다음 평일'
 */

export type Holiday = {
  date: string; // YYYY-MM-DD
  name: string;
  substitute?: boolean;
};

const LIST: Holiday[] = [
  // 2025
  { date: "2025-01-01", name: "신정" },
  { date: "2025-01-28", name: "설날 연휴" },
  { date: "2025-01-29", name: "설날" },
  { date: "2025-01-30", name: "설날 연휴" },
  { date: "2025-03-01", name: "삼일절" },
  { date: "2025-03-03", name: "삼일절 대체공휴일", substitute: true },
  { date: "2025-05-01", name: "근로자의 날" },
  { date: "2025-05-05", name: "어린이날·부처님오신날" },
  { date: "2025-05-06", name: "대체공휴일", substitute: true },
  { date: "2025-06-06", name: "현충일" },
  { date: "2025-08-15", name: "광복절" },
  { date: "2025-10-03", name: "개천절" },
  { date: "2025-10-05", name: "추석 연휴" },
  { date: "2025-10-06", name: "추석" },
  { date: "2025-10-07", name: "추석 연휴" },
  { date: "2025-10-08", name: "대체공휴일", substitute: true },
  { date: "2025-10-09", name: "한글날" },
  { date: "2025-12-25", name: "성탄절" },

  // 2026
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날 연휴" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날 연휴" },
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "삼일절 대체공휴일", substitute: true },
  { date: "2026-05-01", name: "근로자의 날" },
  { date: "2026-05-05", name: "어린이날" },
  { date: "2026-05-24", name: "부처님오신날" },
  { date: "2026-05-25", name: "대체공휴일", substitute: true },
  { date: "2026-06-06", name: "현충일" },
  { date: "2026-08-15", name: "광복절" },
  { date: "2026-08-17", name: "광복절 대체공휴일", substitute: true },
  { date: "2026-09-24", name: "추석 연휴" },
  { date: "2026-09-25", name: "추석" },
  { date: "2026-09-26", name: "추석 연휴" },
  { date: "2026-10-03", name: "개천절" },
  { date: "2026-10-05", name: "개천절 대체공휴일", substitute: true },
  { date: "2026-10-09", name: "한글날" },
  { date: "2026-12-25", name: "성탄절" },

  // 2027
  { date: "2027-01-01", name: "신정" },
  { date: "2027-02-06", name: "설날 연휴" },
  { date: "2027-02-07", name: "설날" },
  { date: "2027-02-08", name: "설날 연휴" },
  { date: "2027-02-09", name: "대체공휴일", substitute: true },
  { date: "2027-03-01", name: "삼일절" },
  { date: "2027-05-01", name: "근로자의 날" },
  { date: "2027-05-05", name: "어린이날" },
  { date: "2027-05-13", name: "부처님오신날" },
  { date: "2027-06-06", name: "현충일" },
  { date: "2027-06-07", name: "현충일 대체공휴일", substitute: true },
  { date: "2027-08-15", name: "광복절" },
  { date: "2027-08-16", name: "광복절 대체공휴일", substitute: true },
  { date: "2027-09-14", name: "추석 연휴" },
  { date: "2027-09-15", name: "추석" },
  { date: "2027-09-16", name: "추석 연휴" },
  { date: "2027-10-03", name: "개천절" },
  { date: "2027-10-04", name: "개천절 대체공휴일", substitute: true },
  { date: "2027-10-09", name: "한글날" },
  { date: "2027-10-11", name: "한글날 대체공휴일", substitute: true },
  { date: "2027-12-25", name: "성탄절" },

  // 2028
  { date: "2028-01-01", name: "신정" },
  { date: "2028-01-26", name: "설날 연휴" },
  { date: "2028-01-27", name: "설날" },
  { date: "2028-01-28", name: "설날 연휴" },
  { date: "2028-03-01", name: "삼일절" },
  { date: "2028-05-01", name: "근로자의 날" },
  { date: "2028-05-02", name: "부처님오신날" },
  { date: "2028-05-05", name: "어린이날" },
  { date: "2028-06-06", name: "현충일" },
  { date: "2028-08-15", name: "광복절" },
  { date: "2028-10-02", name: "추석 연휴" },
  { date: "2028-10-03", name: "추석·개천절" },
  { date: "2028-10-04", name: "추석 연휴" },
  { date: "2028-10-05", name: "대체공휴일", substitute: true },
  { date: "2028-10-09", name: "한글날" },
  { date: "2028-12-25", name: "성탄절" },
];

const MAP = new Map<string, Holiday>();
for (const h of LIST) MAP.set(h.date, h);

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export function getHoliday(d: Date): Holiday | undefined {
  return MAP.get(ymd(d));
}


