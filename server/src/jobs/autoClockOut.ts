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
    // 1) 자동 퇴근 대상 사용자
    const users = await prisma.user.findMany({
      where: {
        active: true,
        autoClockOutTime: hhmm,
      },
      select: { id: true },
    });
    if (users.length === 0) return;

    // 2) 각 사용자의 오늘 출근기록에 대해 checkOut 채움 — updateMany 로 단일 쿼리.
    //    복합 unique(userId,date) 라 updateMany 는 통과하지만,
    //    "checkIn 있고 checkOut 없음" 조건을 함께 걸어 멱등성 보장.
    const now = new Date();
    const result = await prisma.attendance.updateMany({
      where: {
        userId: { in: users.map((u) => u.id) },
        date: ymd,
        checkIn: { not: null },
        checkOut: null,
      },
      data: { checkOut: now, note: "자동 퇴근" },
    });

    if (result.count > 0) {
      console.log(
        `[autoClockOut] ${ymd} ${hhmm} KST — 자동 퇴근 처리 ${result.count}건 (대상 ${users.length}명)`
      );
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
