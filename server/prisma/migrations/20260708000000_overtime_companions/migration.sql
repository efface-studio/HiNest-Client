-- 야근 신청 함께 근무자 스냅샷(JSON [{id,name}]) — 추가형 컬럼(운영 RDS 는 기동 시 migrate deploy 멱등 적용)
ALTER TABLE "OvertimeRequest" ADD COLUMN "companions" TEXT;
