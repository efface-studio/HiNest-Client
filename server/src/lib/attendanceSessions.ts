/**
 * 근태 다중 세션 헬퍼.
 *
 * Attendance.sessions(Json) = [{ s: ISO 시작, e: ISO 종료|null(근무중), src }].
 * "다시 출근" 시 이전 세션을 덮어쓰지 않고 새 세션을 추가 → 데이터 손실 방지 + 근무시간 합산.
 * sessions 가 없는 과거 레코드는 checkIn/checkOut 을 단일 세션으로 간주(하위호환).
 */

export type WorkSession = { s: string; e: string | null; src?: string };

type AttendanceLike = {
  sessions?: unknown;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
};

/** 레코드 → 정규화된 세션 배열. sessions 없으면 checkIn/checkOut 으로 단일 세션 구성. */
export function normalizeSessions(rec: AttendanceLike | null | undefined): WorkSession[] {
  if (!rec) return [];
  const raw = rec.sessions;
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is WorkSession => !!x && typeof (x as any).s === "string")
      .map((x) => ({ s: x.s, e: x.e ?? null, src: x.src }));
  }
  if (rec.checkIn) {
    return [{
      s: new Date(rec.checkIn).toISOString(),
      e: rec.checkOut ? new Date(rec.checkOut).toISOString() : null,
      src: "manual",
    }];
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
