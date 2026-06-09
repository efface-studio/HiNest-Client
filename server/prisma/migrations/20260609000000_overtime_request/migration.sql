-- 야근(추가근무) 신청 테이블. 새 테이블만 추가 — 비파괴적.
CREATE TABLE "OvertimeRequest" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "userId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "extendedEnd" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewer" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OvertimeRequest_userId_status_idx" ON "OvertimeRequest"("userId", "status");
CREATE INDEX "OvertimeRequest_status_idx" ON "OvertimeRequest"("status");
CREATE INDEX "OvertimeRequest_companyId_status_idx" ON "OvertimeRequest"("companyId", "status");

ALTER TABLE "OvertimeRequest"
  ADD CONSTRAINT "OvertimeRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
