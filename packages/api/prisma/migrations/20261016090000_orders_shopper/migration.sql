-- The Shopper side of orders (docs/STILL_TO_DO.md items 1, 2, 4, 6, 7 and 10, and the
-- account closing and retention jobs in docs/LEGAL_REVIEW.md): till cases for a person,
-- receipt photos, Sets that send themselves, the door safe word, feedback with delivery
-- credit, and closed accounts.

-- AlterTable
ALTER TABLE "Shopper" ADD COLUMN     "erasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "anonymisedAt" TIMESTAMP(3),
ADD COLUMN     "doorWord" TEXT,
ADD COLUMN     "setFireAt" TIMESTAMP(3),
ADD COLUMN     "tillReason" TEXT,
ADD COLUMN     "tillSettledAt" TIMESTAMP(3),
ADD COLUMN     "tillSettledBy" TEXT,
ADD COLUMN     "tillStatus" TEXT;

-- AlterTable
ALTER TABLE "Set" ADD COLUMN     "autoSendAgreedAt" TIMESTAMP(3),
ADD COLUMN     "autoSendStatement" TEXT;

-- CreateTable
CREATE TABLE "ReceiptPhoto" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopperFeedback" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rating" INTEGER,
    "themes" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "creditPence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopperFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptPhoto_orderId_key" ON "ReceiptPhoto"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopperFeedback_orderId_key" ON "ShopperFeedback"("orderId");

-- CreateIndex
CREATE INDEX "ShopperFeedback_createdAt_idx" ON "ShopperFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "Order_tillStatus_idx" ON "Order"("tillStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Order_setId_setFireAt_key" ON "Order"("setId", "setFireAt");

