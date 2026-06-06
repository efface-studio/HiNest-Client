-- 1:1 대화 'per-user 숨김(나만 삭제)'. RoomMember 에 hiddenAt 컬럼 추가.
-- 가산형(ADD COLUMN, nullable) — PostgreSQL 11+ 에서 메타데이터 전용 연산이라
-- 테이블 재작성/락 없이 즉시 적용된다. 기존 행은 NULL(숨김 안 함, 비파괴적).
ALTER TABLE "RoomMember" ADD COLUMN "hiddenAt" TIMESTAMP(3);
