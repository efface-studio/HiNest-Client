/**
 * DB 유지보수 잡 — 만료/폐기된 row 를 주기적으로 정리.
 *
 * 왜 필요한가:
 *  - Session 테이블: 로그인할 때마다 row 가 생기고, revoke 해도 바로 지워지지 않는다.
 *    접속이 많은 운영 환경에서 수개월이면 수만 건 누적 → 인덱스 비대, 조회 느려짐.
 *  - PasswordResetToken 테이블: 만료/사용 후에도 영구 보관. 토큰은 SHA-256 해시라
 *    보안 가치가 없으므로 일정 기간 후 삭제해도 무방.
 *  - ShareLinkAccess 테이블: 공유 링크 접근 로그. 90일 이상 된 접근 기록은 감사 가치가 낮음.
 *
 * 정책 (보수적으로 잡음 — 의도치 않은 삭제보다 DB 비용이 낮음):
 *  - Session: revokedAt != null 이고 revokedAt 이 7일 초과 → 삭제
 *  - Session: revokedAt == null 이고 lastSeenAt 이 90일 초과 → 삭제 (idle/zombie)
 *  - PasswordResetToken: expiresAt < now() 이고 7일 초과 → 삭제
 *  - ShareLinkAccess: createdAt 90일 초과 → 삭제
 *
 * 스케줄: 매일 새벽 3시(KST) 1회 실행. 타이밍은 서버 기동 시각 기준으로 맞춤.
 * 멱등성: 이미 없으면 deleteMany 는 0건 반환하므로 재실행 안전.
 *
 * 스케일:
 *  멀티 인스턴스(Fargate) 환경에서 각 태스크가 동시에 실행해도 MVCC 특성상
 *  deleteMany 가 충돌 없이 안전하게 동작함 (중복 삭제 X, 에러 X).
 *  태스크가 많을수록 같은 행을 여러 번 시도하지만 결과는 동일하고 비용도 무시할 수준.
 */

import { prisma } from "../lib/db.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

async function runMaintenance(): Promise<void> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS);
  const ninetyDaysAgo = new Date(now - NINETY_DAYS_MS);

  let total = 0;

  // 1) 폐기된 세션 (revoke 후 7일 경과) — 이미 로그아웃된 세션, 보관 불필요
  const revokedSessions = await prisma.session.deleteMany({
    where: {
      revokedAt: { not: null, lt: sevenDaysAgo },
    },
  });
  total += revokedSessions.count;

  // 2) 방치된 세션 (90일간 lastSeen 없음) — 장기간 미사용, 실질적으로 만료
  const idleSessions = await prisma.session.deleteMany({
    where: {
      revokedAt: null,
      lastSeenAt: { lt: ninetyDaysAgo },
    },
  });
  total += idleSessions.count;

  // 3) 만료된 비밀번호 재설정 토큰 (만료 후 7일 경과) — SHA-256 해시, 복구 불가능, 보관 가치 없음
  const expiredTokens = await prisma.passwordResetToken.deleteMany({
    where: {
      expiresAt: { lt: sevenDaysAgo },
    },
  });
  total += expiredTokens.count;

  // 4) 공유 링크 접근 로그 (90일 경과) — 감사 기간 이후는 저장 비용만 발생
  const staleAccessLogs = await prisma.shareLinkAccess.deleteMany({
    where: {
      createdAt: { lt: ninetyDaysAgo },
    },
  });
  total += staleAccessLogs.count;

  if (total > 0) {
    console.log(
      `[dbMaintenance] 정리 완료: sessions(revoked)=${revokedSessions.count} sessions(idle)=${idleSessions.count} pwdTokens=${expiredTokens.count} shareLinkAccess=${staleAccessLogs.count} total=${total}`,
    );
  }
}

let _maintenanceStarted = false;

/** 서버 기동 시 1회 호출. 이후 매일 KST 03:00 근처에 자동 실행. */
export function startDbMaintenance(): void {
  if (_maintenanceStarted) return;
  _maintenanceStarted = true;

  // 다음 KST 03:00 까지 대기. 서버가 새벽 3시 전후로 재기동돼도 당일 1회 보장.
  // UTC+9 이므로 KST 03:00 = UTC 18:00 (전날).
  function msUntilNextKst3am(): number {
    const now = new Date();
    // KST 현재 HH:mm 계산
    const kstStr = now.toLocaleString("en-CA", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const [hh, mm] = kstStr.split(":").map(Number);
    const minutesSinceMidnight = hh * 60 + mm;
    const target = 3 * 60; // 03:00
    const minutesToTarget =
      minutesSinceMidnight < target
        ? target - minutesSinceMidnight
        : 24 * 60 - minutesSinceMidnight + target;
    return minutesToTarget * 60 * 1000;
  }

  function scheduleNext(): void {
    const delay = msUntilNextKst3am();
    setTimeout(async () => {
      try {
        await runMaintenance();
      } catch (e) {
        console.error("[dbMaintenance] 실행 실패:", e);
      }
      scheduleNext(); // 매일 반복
    }, delay);
    const hours = Math.round(delay / 3_600_000);
    console.log(`[dbMaintenance] 다음 실행까지 ${hours}시간 (KST 03:00)`);
  }

  scheduleNext();
}
