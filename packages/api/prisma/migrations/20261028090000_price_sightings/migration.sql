-- Prices seen for things (20 October 2026, ruling 72): read off till receipts, from the open
-- price database, or found by a web lookup. The catalogue estimate follows the best of them;
-- the Shopper still pays the till price.
CREATE TABLE "PriceSighting" (
    "id" TEXT NOT NULL,
    "catalogueItemId" TEXT,
    "name" TEXT NOT NULL,
    "pricePence" INTEGER NOT NULL,
    "shop" TEXT,
    "source" TEXT NOT NULL,
    "orderId" TEXT,
    "barcode" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceSighting_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PriceSighting_catalogueItemId_seenAt_idx" ON "PriceSighting"("catalogueItemId", "seenAt");
CREATE INDEX "PriceSighting_source_seenAt_idx" ON "PriceSighting"("source", "seenAt");
CREATE INDEX "PriceSighting_seenAt_idx" ON "PriceSighting"("seenAt");
