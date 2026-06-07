-- 회사 출근 IP 화이트리스트.
-- Company 에 attendanceIpRestrictEnabled(기본 false) + 새 모델 CompanyAttendanceAllowedIp.
-- 비파괴적: ADD COLUMN NOT NULL DEFAULT 는 PG 11+ 에서 메타데이터 전용 연산, 테이블 재작성·락 없음.

ALTER TABLE "Company" ADD COLUMN "attendanceIpRestrictEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CompanyAttendanceAllowedIp" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "cidr" TEXT NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "CompanyAttendanceAllowedIp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyAttendanceAllowedIp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CompanyAttendanceAllowedIp_companyId_idx" ON "CompanyAttendanceAllowedIp"("companyId");
