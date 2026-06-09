/**
 * 근태 다중 세션 헬퍼.
 *
 * Attendance.sessions(Json) = [{ s: ISO 시작, e: ISO 종료|null(근무중), src }].
 * "다시 출근" 시 이전 세션을 덮어쓰지 않고 새 세션을 추가 → 데이터 손실 방지 + 근무시간 합산.
 * sessions 가 없는 과거 레코드는 checkIn/checkOut 을 단일 세션으로 간주(하위호환).
 */

export type WorkSession = { s: string; e: string | null; src?: string };

type AttendanceLike = {
  date?: string | null; // YYYY-MM-DD (KST). 닫히지 않은 과거 세션 캡에 사용.
  sessions?: unknown;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
};

/** 오늘 KST(YYYY-MM-DD). dates.ts 의 todayStr 과 동일 로직(순환 import 회피용 인라인). */
function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).replaceAll("/", "-");
}

/** 닫히지 않은 과거 세션은 그날 KST 자정(23:59:59)으로 캡 — 옛날 자동퇴근 누락 데이터로 인해
 *  workedMinutes 가 now 까지 누적돼 비정상 큰 값(예: 수백~수천 시간)이 나오는 걸 막는다. */
function clampOpenEnd(s: WorkSession, rowDate: string | null | undefined): WorkSession {
  if (s.e) return s;
  if (!rowDate) return s;
  if (rowDate < kstToday()) {
    return { ...s, e: `${rowDate}T23:59:59+09:00` };
  }
  return s;
}

/** 레코드 → 정규화된 세션 배열. sessions 없으면 checkIn/checkOut 으로 단일 세션 구성.
 *  과거 행에서 닫히지 않은 세션은 그날 자정으로 자동 캡(데이터 손상 방어). */
export function normalizeSessions(rec: AttendanceLike | null | undefined): WorkSession[] {
  if (!rec) return [];
  const raw = rec.sessions;
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is WorkSession => !!x && typeof (x as any).s === "string")
      .map((x) => clampOpenEnd({ s: x.s, e: x.e ?? null, src: x.src }, rec.date));
  }
  if (rec.checkIn) {
    return [clampOpenEnd({
      s: new Date(rec.checkIn).toISOString(),
      e: rec.checkOut ? new Date(rec.checkOut).toISOString() : null,
      src: "manual",
    }, rec.date)];
  }
  return [];
}

/** 세션 합산 근무 분(分). 열린 세션은 now 까지 계산. */
export function workedMinutes(sessions: WorkSession[], now: Date = new Date()): number {
  let ms = 0;
  for (const s of sessions) {
    const start = new Date(s.s).getTime();
    const end = s.e ? new Date(s.e).getTime() : now.getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ms += end - start;
  }
  return Math.floor(ms / 60000);
}

/** 현재 근무 중(닫히지 않은 세션 존재)인가. */
export function hasOpenSession(sessions: WorkSession[]): boolean {
  return sessions.some((s) => !s.e);
}

/** 열린 세션을 모두 now 로 닫는다. 닫은 게 있으면 true. */
export function closeOpenSessions(sessions: WorkSession[], now: Date = new Date()): boolean {
  let closed = false;
  for (const s of sessions) {
    if (!s.e) { s.e = now.toISOString(); closed = true; }
  }
  return closed;
}
