-- Shop of the Month and review points (ruling 70, 16 and 17 October 2026): a Shopper's review
-- of a Shop Partner after a delivered order, one per order per shop, with the points it earns
-- (pending for seven days, then earned, or void if the order was refunded); and the record of
-- points turned into delivery credit.
CREATE TABLE "ShopReview" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "points" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "earnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopReview_orderId_partnerShopId_key" ON "ShopReview"("orderId", "partnerShopId");
CREATE INDEX "ShopReview_shopperId_createdAt_idx" ON "ShopReview"("shopperId", "createdAt");
CREATE INDEX "ShopReview_partnerShopId_createdAt_idx" ON "ShopReview"("partnerShopId", "createdAt");
CREATE INDEX "ShopReview_status_createdAt_idx" ON "ShopReview"("status", "createdAt");

CREATE TABLE "ReviewPointsSpend" (
    "id" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "pence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewPointsSpend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewPointsSpend_shopperId_idx" ON "ReviewPointsSpend"("shopperId");
