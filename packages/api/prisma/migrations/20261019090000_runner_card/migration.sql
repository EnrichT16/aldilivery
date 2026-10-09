-- The spending card for Runners (Anthony, 9 October 2026): Runners pay at the till with a
-- card from Stripe Issuing, loaded for each order, or with their own card and are paid back
-- (ruling 55). How each Runner pays, their card's identifiers and last four digits (never the
-- number, Rule Ten), the cardholder terms they accepted, what each order's card was loaded with
-- and spent, and every authorization and transaction on the cards. docs/changes/runner-card.md.
-- AlterTable
ALTER TABLE "Runner" ADD COLUMN     "cardLast4" TEXT,
ADD COLUMN     "cardStatus" TEXT,
ADD COLUMN     "issuingCardId" TEXT,
ADD COLUMN     "issuingCardholderId" TEXT,
ADD COLUMN     "issuingTermsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "issuingTermsAcceptedIp" TEXT,
ADD COLUMN     "payMethod" TEXT NOT NULL DEFAULT 'own';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cardLimitPence" INTEGER,
ADD COLUMN     "cardMerchant" TEXT,
ADD COLUMN     "cardSpentPence" INTEGER,
ADD COLUMN     "payMethodUsed" TEXT;

-- CreateTable
CREATE TABLE "CardAuthorization" (
    "id" TEXT NOT NULL,
    "stripeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT,
    "runnerId" TEXT,
    "amountPence" INTEGER NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "merchant" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardAuthorization_stripeId_key" ON "CardAuthorization"("stripeId");

-- CreateIndex
CREATE INDEX "CardAuthorization_orderId_idx" ON "CardAuthorization"("orderId");

-- CreateIndex
CREATE INDEX "CardAuthorization_runnerId_at_idx" ON "CardAuthorization"("runnerId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Runner_issuingCardId_key" ON "Runner"("issuingCardId");

-- AddForeignKey
ALTER TABLE "CardAuthorization" ADD CONSTRAINT "CardAuthorization_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAuthorization" ADD CONSTRAINT "CardAuthorization_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

