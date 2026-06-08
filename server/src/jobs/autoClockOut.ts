/**
 * 자동 퇴근 스케줄러.
 *
 * 동작:
 *  - 서버 시작 시 start() 가 호출되면 매 분 정각 근처(다음 0초 맞춤 후 60초 간격)에 tick.
 *  - tick 에서 "현재 KST HH:mm" 과 일치하는 User.autoClockOutTime 을 가진 활성 사용자 조회.
 *  - 오늘 Attendance(= KST 기준 YYYY-MM-DD) 가 checkIn 은 있고 checkOut 이 null 이면
 *    checkOut = now() 로 업서트.
 *
 * 멱등성:
 *  - updateMany 의 where 조건에 `checkOut: null` 을 포함해 이미 퇴근 처리된 건은 건드리지 않음.
 *  - 같은 분에 tick 이 여러 번 돌아도(드물지만 재시작 직후 등) 중복 업데이트 없음.
 *
 * 타임존:
 *  - KST(Asia/Seoul) 고정. 서버는 UTC 로 돌아도 OK — Intl.DateTimeFormat 으로 KST 계산.
 *
 * 스케일:
 *  - 현재 설계는 단일 인스턴스 기준. Fargate 에서 멀티 태스크로 스케일아웃 시
 *    updateMany WHERE checkOut IS NULL 조건 덕분에 중복 처리 없이 안전.
 *    (같은 행을 여러 태스크가 동시에 업데이트해도 두 번째 이후는 0건 반환으로 멱등)
 */

import { prisma } from "../lib/db.js";
import { normalizeSessions, hasOpenSession, closeOpenSessions } from "../lib/attendanceSessions.js";

/** 기본 퇴근시간 — workEndTime 미설정(null) 사용자에게 적용. */
const DEFAULT_END = "18:00";

/** KST 현재 시각을 { hhmm, ymd } 로 반환. */
function nowInKst(): { hhmm: string; ymd: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // 24:xx → 00:xx 로 정규화 (일부 환경에서 hour12:false + en-CA 가 "24" 를 돌려주는 이슈 대비)
  const hourRaw = pick("hour");
  const hour = hourRaw === "24" ? "00" : hourRaw;
  const hhmm = `${hour}:${pick("minute")}`;
  const ymd = `${pick("year")}-${pick("month")}-${pick("day")}`;
  return { hhmm, ymd };
}

async function tick() {
  try {
    const { hhmm, ymd } = nowInKst();
    // 1) 퇴근시간(workEndTime, 미설정 시 18:00)이 지금(hhmm)인 활성 사용자.
    //    ※ 자동퇴근 기준을 별도 autoClockOutTime → workEndTime 으로 전환(설정 불일치로 엉뚱한
    //       시각에 퇴근되던 버그 해결). 미설정 사용자는 기본 18:00 에 적용.
    const where =
      hhmm === DEFAULT_END
        ? { active: true, OR: [{ workEndTime: DEFAULT_END }, { workEndTime: null }] }
        : { active: true, workEndTime: hhmm };
    const users = await prisma.user.findMany({ where, select: { id: true } });
    if (users.length === 0) return;

    // 2) 그 사용자들의 오늘 근태 중 '열린 세션'이 있는 것만 닫아 자동 퇴근.
    const recs = await prisma.attendance.findMany({
      where: { userId: { in: users.map((u) => u.id) }, date: ymd },
    });
    const now = new Date();
    let count = 0;
    for (const rec of recs) {
      // 야근(추가근무) 승인으로 연장됐으면 그 시각까지 자동퇴근 보류.
      if (rec.overtimeUntil && new Date(rec.overtimeUntil).getTime() > now.getTime()) continue;
      const sessions = normalizeSessions(rec);
      if (!hasOpenSession(sessions)) continue; // 이미 퇴근했거나 출근 안 함 → 건너뜀(멱등)
      closeOpenSessions(sessions, now);
      await prisma.attendance.update({
        where: { id: rec.id },
        data: { sessions: sessions as unknown as object, checkOut: now, note: "자동 퇴근" },
      });
      count++;
    }

    if (count > 0) {
      console.log(`[autoClockOut] ${ymd} ${hhmm} KST — 자동 퇴근 ${count}건 (대상 ${users.length}명)`);
    }
  } catch (e) {
    // 스케줄러는 절대 프로세스를 죽이지 않음 — 다음 tick 에서 재시도.
    console.error("[autoClockOut] tick 실패:", e);
  }
}

let started = false;

export function startAutoClockOut() {
  if (started) return;
  started = true;

  // 다음 분 정각까지 대기 후 매 60초 간격으로 tick.
  // 이렇게 하면 "HH:mm 이 바뀌는 순간" 에 가장 가깝게 실행돼
  // 사용자가 설정한 시간과 실제 퇴근 처리 시각의 오차가 ≤ 1분.
  const msToNextMinute = 60_000 - (Date.now() % 60_000);
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), 60_000);
  }, msToNextMinute);

  console.log(`[autoClockOut] 스케줄러 시작 — 다음 tick 까지 ${msToNextMinute}ms`);
}
