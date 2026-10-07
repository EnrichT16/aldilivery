-- Ozi Plus and the family plan, gift card credit (7 October 2026).
ALTER TABLE "Shopper" ADD COLUMN "plusUntil" TIMESTAMP(3);
ALTER TABLE "Shopper" ADD COLUMN "plusFamily" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shopper" ADD COLUMN "familyCode" TEXT;
ALTER TABLE "Shopper" ADD COLUMN "familyOwnerId" TEXT;
ALTER TABLE "Shopper" ADD COLUMN "creditPence" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Shopper_familyCode_key" ON "Shopper"("familyCode");

ALTER TABLE "Order" ADD COLUMN "creditAppliedPence" INTEGER NOT NULL DEFAULT 0;

-- Ozi Finds It.
CREATE TABLE "FindRequest" (
    "id" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "feePence" INTEGER NOT NULL,
    "chargeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'looking',
    "foundName" TEXT,
    "foundShop" TEXT,
    "foundPricePence" INTEGER,
    "catalogueItemId" TEXT,
    "refundId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "FindRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FindRequest_shopperId_idx" ON "FindRequest"("shopperId");
CREATE INDEX "FindRequest_status_idx" ON "FindRequest"("status");

-- Gift cards.
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "buyerShopperId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "redeemedByShopperId" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");
CREATE INDEX "GiftCard_buyerShopperId_idx" ON "GiftCard"("buyerShopperId");

-- Organisations asking to work with us.
CREATE TABLE "OrganisationEnquiry" (
    "id" TEXT NOT NULL,
    "organisation" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "people" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganisationEnquiry_pkey" PRIMARY KEY ("id")
);
