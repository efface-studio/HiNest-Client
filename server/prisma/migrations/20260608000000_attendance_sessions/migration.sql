-- 근태 다중 세션 + 야근 연장.
-- Attendance 에 sessions(JSONB, 다중 출퇴근 세션) + overtimeUntil(연장된 자동퇴근 시각) 추가.
-- 둘 다 nullable → 기존 행에 NULL 이 채워지는 비파괴적 추가(테이블 락·재작성 없음).
-- sessions 가 NULL 인 과거 행은 애플리케이션이 checkIn/checkOut 을 단일 세션으로 해석(하위호환).

ALTER TABLE "Attendance" ADD COLUMN "sessions" JSONB;
ALTER TABLE "Attendance" ADD COLUMN "overtimeUntil" TIMESTAMP(3);
