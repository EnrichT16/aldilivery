-- Problems with an order (rulings of 2 October 2026): reports with evidence, decided by a
-- person within two working days, and what a Runner found at fault repays, a little from each
-- job. Adds tables and one column with a default; changes nothing that exists.

-- AlterTable
ALTER TABLE "RunnerPayout" ADD COLUMN     "recoveryWithheldPence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProblemReport" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "refundRequestedPence" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decideBy" TIMESTAMP(3) NOT NULL,
    "decision" TEXT,
    "refundPence" INTEGER NOT NULL DEFAULT 0,
    "refundReference" TEXT,
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemEvidence" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" BYTEA,
    "contentType" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunnerRecovery" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "recoveredPence" INTEGER NOT NULL DEFAULT 0,
    "writtenOff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProblemReport_status_decideBy_idx" ON "ProblemReport"("status", "decideBy");

-- CreateIndex
CREATE INDEX "ProblemReport_orderId_idx" ON "ProblemReport"("orderId");

-- CreateIndex
CREATE INDEX "ProblemEvidence_reportId_idx" ON "ProblemEvidence"("reportId");

-- CreateIndex
CREATE INDEX "RunnerRecovery_runnerId_idx" ON "RunnerRecovery"("runnerId");

-- AddForeignKey
ALTER TABLE "ProblemEvidence" ADD CONSTRAINT "ProblemEvidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProblemReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

