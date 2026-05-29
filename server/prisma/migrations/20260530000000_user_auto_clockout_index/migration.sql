-- 자동 퇴근 스케줄러 성능 인덱스
--
-- jobs/autoClockOut.ts 의 tick() 이 매 60초 prisma.user.findMany({ where: { active, autoClockOutTime } })
-- 를 실행하는데, User 에는 @unique(email) 외 인덱스가 없어 매 분 풀스캔(1440회/일)이 발생했다.
-- autoClockOutTime 은 대부분 NULL 이라 인덱스 크기는 작고, 동등 조건이 인덱스 probe 로 떨어진다.
CREATE INDEX "User_autoClockOutTime_idx" ON "User"("autoClockOutTime");
