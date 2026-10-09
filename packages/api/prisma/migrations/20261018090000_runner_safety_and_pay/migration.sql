-- Runners: the SOS button and its private live-location link, the payout schedule, leaving
-- (and the cool bag deposit paid back), insurance reminders, and the private referral reward
-- (Section M; rulings 12, 14 and 16; docs/LEGAL_REVIEW.md).

-- AlterTable
ALTER TABLE "Runner" ADD COLUMN     "coolBagRefundNote" TEXT,
ADD COLUMN     "coolBagRefundTransferId" TEXT,
ADD COLUMN     "coolBagRefundedAt" TIMESTAMP(3),
ADD COLUMN     "coolBagRefundedPence" INTEGER,
ADD COLUMN     "insuranceReminderDays" INTEGER,
ADD COLUMN     "insuranceReminderFor" TIMESTAMP(3),
ADD COLUMN     "leftAt" TIMESTAMP(3),
ADD COLUMN     "leftBy" TEXT,
ADD COLUMN     "leftReason" TEXT,
ADD COLUMN     "payoutSchedule" TEXT NOT NULL DEFAULT 'weekly';

-- CreateTable
CREATE TABLE "RunnerSos" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "orderId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMetres" DOUBLE PRECISION,
    "locationAt" TIMESTAMP(3),
    "linkCodeHash" TEXT NOT NULL,
    "linkExpiresAt" TIMESTAMP(3) NOT NULL,
    "alertSentAt" TIMESTAMP(3),
    "alertProblem" TEXT,

    CONSTRAINT "RunnerSos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "referrer" TEXT NOT NULL,
    "qualifyingCount" INTEGER NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "decidedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunnerSos_linkCodeHash_key" ON "RunnerSos"("linkCodeHash");

-- CreateIndex
CREATE INDEX "RunnerSos_runnerId_endedAt_idx" ON "RunnerSos"("runnerId", "endedAt");

-- CreateIndex
CREATE INDEX "ReferralReward_referrer_idx" ON "ReferralReward"("referrer");

-- AddForeignKey
ALTER TABLE "RunnerSos" ADD CONSTRAINT "RunnerSos_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

