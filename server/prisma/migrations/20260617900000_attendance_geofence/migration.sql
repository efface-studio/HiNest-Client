-- 회사 출근 위치(지오펜스) 자동출근.
-- Company 에 attendanceGeoEnabled(기본 false) + 새 모델 CompanyAttendanceGeofence.
-- 비파괴적: ADD COLUMN NOT NULL DEFAULT 는 PG 11+ 에서 메타데이터 전용 연산, 테이블 재작성·락 없음.

ALTER TABLE "Company" ADD COLUMN "attendanceGeoEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CompanyAttendanceGeofence" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "radiusM" INTEGER NOT NULL DEFAULT 150,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "CompanyAttendanceGeofence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyAttendanceGeofence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CompanyAttendanceGeofence_companyId_idx" ON "CompanyAttendanceGeofence"("companyId");
