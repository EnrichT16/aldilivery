-- Sending jobs straight to a chosen Runner, outside the queue (24 October 2026, ruling 80). The
-- owner, and staff he lets allocate (a new permission on the staff account, given only by him in
-- Team), may send any number of orders to any number of Runners. Each allocation is kept: who
-- sent it, which order, which Runner, when, the backup Runner if one was chosen, whether a booked
-- order may go early, and what became of it. It is queued for a Runner whose hands are full and
-- offered when they are free, as a priority offer held only for them, longer than a queue offer.
-- A Runner may now allow notifications on a device, so the office can tell them of a job sent.

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN "canAllocate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JobOffer" ADD COLUMN "allocated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "runnerId" TEXT;

-- CreateIndex
CREATE INDEX "PushSubscription_runnerId_idx" ON "PushSubscription"("runnerId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "JobAllocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "backupRunnerId" TEXT,
    "allowEarly" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "allocatedById" TEXT,
    "allocatedByName" TEXT NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offerId" TEXT,
    "offeredAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "returnedTo" TEXT,
    "backupOfId" TEXT,

    CONSTRAINT "JobAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobAllocation_runnerId_status_idx" ON "JobAllocation"("runnerId", "status");

-- CreateIndex
CREATE INDEX "JobAllocation_orderId_idx" ON "JobAllocation"("orderId");

-- CreateIndex
CREATE INDEX "JobAllocation_status_idx" ON "JobAllocation"("status");

-- AddForeignKey
ALTER TABLE "JobAllocation" ADD CONSTRAINT "JobAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAllocation" ADD CONSTRAINT "JobAllocation_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
