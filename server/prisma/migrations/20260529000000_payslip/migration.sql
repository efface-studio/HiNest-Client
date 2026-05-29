-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "employeeId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT '주식회사 하이비츠',
    "employeeName" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "joinDate" TEXT,
    "payDate" TEXT,
    "idNumber" TEXT,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "attendance" JSONB,
    "calcRows" JSONB,
    "memo" TEXT DEFAULT '귀하의 노고에 감사드립니다.',
    "totalEarnings" INTEGER NOT NULL DEFAULT 0,
    "totalDeductions" INTEGER NOT NULL DEFAULT 0,
    "netPay" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payslip_employeeId_year_month_idx" ON "Payslip"("employeeId", "year", "month");

-- CreateIndex
CREATE INDEX "Payslip_year_month_idx" ON "Payslip"("year", "month");

-- CreateIndex
CREATE INDEX "Payslip_deletedAt_idx" ON "Payslip"("deletedAt");

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

