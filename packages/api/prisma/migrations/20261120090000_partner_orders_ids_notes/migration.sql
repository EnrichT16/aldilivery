-- Partners see their orders and reach their Runner; speakable IDs for everyone; Shopper notes
-- (Anthony, 5 November 2026, ruling 97). Additive only.
--
-- * Shopper.publicId, PartnerShop.publicId, Organisation.publicId, StaffMember.publicId: each
--   person's speakable public ID (S-, P-, G-, T- and six characters), made once on first read.
--   Runners keep their Runner ID (referralCode) as it is.
-- * Order.readyAt: when the Shop Partner said the order was ready for pickup, once.
-- * Order.note: the Shopper's note for the whole order.
-- * Call.partnerShopId: a call a Shop Partner started to the Runner, and which shop.
-- * PartnerOrderMessage: the short set messages a partner sent the Runner about an order.

-- AlterTable
ALTER TABLE "Shopper" ADD COLUMN "publicId" TEXT;

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "publicId" TEXT;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN "publicId" TEXT;

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN "publicId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "readyAt" TIMESTAMP(3),
ADD COLUMN "note" TEXT;

-- AlterTable
ALTER TABLE "Call" ADD COLUMN "partnerShopId" TEXT;

-- CreateTable
CREATE TABLE "PartnerOrderMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "words" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerOrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shopper_publicId_key" ON "Shopper"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerShop_publicId_key" ON "PartnerShop"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_publicId_key" ON "Organisation"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_publicId_key" ON "StaffMember"("publicId");

-- CreateIndex
CREATE INDEX "PartnerOrderMessage_orderId_idx" ON "PartnerOrderMessage"("orderId");
