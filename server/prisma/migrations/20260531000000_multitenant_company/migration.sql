-- 멀티테넌시 1단계: Company 테이블 + User.companyId / platformAdmin.
-- 기존 단일 회사 데이터를 기본 회사(주식회사 하이비츠, id="company_default")에 귀속시킨다.
-- companyId 는 NULL 허용 — 플랫폼 운영자(platformAdmin)는 어느 회사에도 속하지 않으므로 NULL.

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "bizRegNo" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "Company_status_idx" ON "Company"("status");

-- AlterTable: User 에 멀티테넌시 컬럼 추가
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;
ALTER TABLE "User" ADD COLUMN "platformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: 기본 회사 생성 + 기존 모든 유저를 기본 회사에 귀속
-- (이미 존재하면 건드리지 않음 — 재실행/수동 적용 안전성)
INSERT INTO "Company" ("id", "name", "status", "createdAt", "updatedAt")
VALUES ('company_default', '주식회사 하이비츠', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

UPDATE "User" SET "companyId" = 'company_default' WHERE "companyId" IS NULL;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");
