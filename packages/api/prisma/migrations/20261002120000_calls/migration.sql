-- In-app calls (docs/BUILD_PROMPT.md, Section F): one row per call, one per person in it.
-- Adds two tables; changes nothing that exists.

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "startedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "priceStatement" TEXT,
    "priceAcceptedAt" TIMESTAMP(3),
    "pencePerMinute" INTEGER NOT NULL,
    "billedMinutes" INTEGER NOT NULL DEFAULT 0,
    "chargePence" INTEGER NOT NULL DEFAULT 0,
    "chargeStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentReference" TEXT,
    "chargedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLeg" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectedSince" TIMESTAMP(3),
    "secondsConnected" INTEGER NOT NULL DEFAULT 0,
    "inviteCodeHash" TEXT,
    "priceStatement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_roomName_key" ON "Call"("roomName");

-- CreateIndex
CREATE INDEX "Call_orderId_idx" ON "Call"("orderId");

-- CreateIndex
CREATE INDEX "Call_shopperId_chargeStatus_idx" ON "Call"("shopperId", "chargeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CallLeg_inviteCodeHash_key" ON "CallLeg"("inviteCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "CallLeg_callId_identity_key" ON "CallLeg"("callId", "identity");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLeg" ADD CONSTRAINT "CallLeg_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

