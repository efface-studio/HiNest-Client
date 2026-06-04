-- 방별 알림 음소거. RoomMember 에 muted 컬럼 추가.
-- 가산형(ADD COLUMN, DEFAULT 상수) — PostgreSQL 11+ 에서 메타데이터 전용 연산이라
-- 테이블 재작성/락 없이 즉시 적용된다. 기존 행은 모두 false 로 채워짐(비파괴적).
ALTER TABLE "RoomMember" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;
