-- Partner shops with their own sign-in and products, and organisation dashboards (7 October 2026).
ALTER TABLE "CatalogueItem" ADD COLUMN "retired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Organisation" ADD COLUMN "joinCode" TEXT;
ALTER TABLE "Organisation" ADD COLUMN "monthlyBudgetPence" INTEGER;
ALTER TABLE "Organisation" ADD COLUMN "staffTripCostPence" INTEGER;
CREATE UNIQUE INDEX "Organisation_joinCode_key" ON "Organisation"("joinCode");

ALTER TABLE "Shopper" ADD COLUMN "organisationOffice" TEXT;

CREATE TABLE "PartnerShop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "telephone" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "monthlyPence" INTEGER NOT NULL,
    "paidUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerShop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerProduct" (
    "id" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricePence" INTEGER NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "expiresOn" TIMESTAMP(3),
    "photo" BYTEA,
    "photoType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "catalogueItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "PartnerProduct_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartnerProduct_partnerShopId_idx" ON "PartnerProduct"("partnerShopId");
CREATE INDEX "PartnerProduct_status_idx" ON "PartnerProduct"("status");

CREATE TABLE "BusinessUser" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "partnerShopId" TEXT,
    "organisationId" TEXT,
    "name" TEXT NOT NULL,
    "office" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastSignInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessUser_username_key" ON "BusinessUser"("username");
