-- Ruling 65 (Anthony, 16 and 17 October 2026): shops join by themselves and are approved by a
-- person; a basic listing is free for the first hundred, Partner Plus is paid from the dashboard;
-- cafés and takeaways pay a commission instead; services list services with a price-from and a
-- duration, and a Shopper can ask for a quote or a call back; Ozi lists well-known shops itself
-- from config/shops-seed.json, which an owner can claim. A partner confirms their mobile with
-- the same one-time codes as everybody else, so the code's role can now be "partner".

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE 'partner';

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'shop',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'plus',
ADD COLUMN     "freeForever" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plusTrialUsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'staff',
ADD COLUMN     "seedKey" TEXT,
ADD COLUMN     "postcode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hours" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contactName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mobile" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "approvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerProduct" ADD COLUMN     "durationMinutes" INTEGER;

-- AlterTable
ALTER TABLE "PartnerPayment" ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "ServiceEnquiry" (
    "id" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productId" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "reply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ServiceEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerShop_seedKey_key" ON "PartnerShop"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPayment_reference_key" ON "PartnerPayment"("reference");

-- CreateIndex
CREATE INDEX "ServiceEnquiry_partnerShopId_idx" ON "ServiceEnquiry"("partnerShopId");

-- CreateIndex
CREATE INDEX "ServiceEnquiry_shopperId_idx" ON "ServiceEnquiry"("shopperId");
