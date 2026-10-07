-- Spotlight, Shop Partner payments, share links, and business analysis (7 October 2026).
ALTER TABLE "PartnerShop" ADD COLUMN "spotlight" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "PartnerShop" ADD COLUMN "spotlightUntil" TIMESTAMP(3);

ALTER TABLE "Shopper" ADD COLUMN "ageBand" TEXT;
ALTER TABLE "Shopper" ADD COLUMN "joinedVia" TEXT;

CREATE TABLE "PartnerPayment" (
    "id" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "coversUntil" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartnerPayment_partnerShopId_idx" ON "PartnerPayment"("partnerShopId");

CREATE TABLE "SpotlightMention" (
    "id" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "shopperKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpotlightMention_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SpotlightMention_shopperKey_at_idx" ON "SpotlightMention"("shopperKey", "at");
CREATE INDEX "SpotlightMention_partnerShopId_at_idx" ON "SpotlightMention"("partnerShopId", "at");

CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "shopperKey" TEXT,
    "runnerKey" TEXT,
    "shop" TEXT,
    "area" TEXT,
    "toArea" TEXT,
    "ageBand" TEXT,
    "viaOrganisation" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "goodsPence" INTEGER NOT NULL DEFAULT 0,
    "categories" TEXT NOT NULL DEFAULT '',
    "query" TEXT,
    "travelMode" TEXT,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsEvent_at_idx" ON "AnalyticsEvent"("at");
CREATE INDEX "AnalyticsEvent_kind_at_idx" ON "AnalyticsEvent"("kind", "at");
CREATE INDEX "AnalyticsEvent_shop_at_idx" ON "AnalyticsEvent"("shop", "at");
