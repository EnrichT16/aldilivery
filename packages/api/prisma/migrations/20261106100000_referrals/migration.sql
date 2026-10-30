-- Referral links for everybody, the referral log and reward levels, and Ozi Ambassadors
-- (Anthony, 30 October 2026).
--
-- Every Shopper, Runner, shop partner and organisation has a referral link, and anyone can refer
-- anyone: each account opened through a link is one Referral row, whoever opened it. Whether a
-- referral is active is worked out from what the account has done, never stored. A reward level
-- reached is kept, with whether staff have given the voucher. These replaced the Runner reward of
-- £150 at 100 referrals; the old ReferralReward rows are left as they were, for the record.
--
-- Somebody chooses to become an Ozi Ambassador by agreeing to the Ambassador terms, with the
-- moment and the version kept, and only then has an Ambassador link. An Ambassador introduces
-- businesses: the shop partner keeps who introduced it, and staff may mark it a branch of another
-- listing of the same business (each branch is its own venture). What the Ambassador earns and is
-- paid is written down as AmbassadorEntry rows, each once only: a share stays pending for 30 days
-- after delivery and follows its order's refunds, a refund after that is a deduction, and only
-- what is available is paid. A withdrawal to their bank goes by Stripe to their own Stripe
-- account (AmbassadorWithdrawal), or waits for staff. An organisation asking to work with us keeps
-- the link it came by until staff set it up.

-- AlterTable
ALTER TABLE "OrganisationEnquiry" ADD COLUMN "joinedVia" TEXT;

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "ambassadorId" TEXT,
ADD COLUMN "ambassadorKind" TEXT,
ADD COLUMN "branchOfShopId" TEXT;

-- CreateTable
CREATE TABLE "AmbassadorAgreement" (
    "id" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "termsVersion" TEXT NOT NULL,
    "stripeConnectedAccountId" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "flagReason" TEXT,

    CONSTRAINT "AmbassadorAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerKind" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "joinedKind" TEXT NOT NULL,
    "joinedId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLevelReached" (
    "id" TEXT NOT NULL,
    "referrerKind" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "activeReferrals" INTEGER NOT NULL,
    "rewardPence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "activeAtReach" INTEGER NOT NULL,
    "joinedAtReach" INTEGER NOT NULL,
    "reachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toldAt" TIMESTAMP(3),
    "givenAt" TIMESTAMP(3),
    "givenBy" TEXT,

    CONSTRAINT "ReferralLevelReached_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorEntry" (
    "id" TEXT NOT NULL,
    "ambassadorKind" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "partnerShopId" TEXT,
    "orderId" TEXT,
    "profitPence" INTEGER NOT NULL DEFAULT 0,
    "amountPence" INTEGER NOT NULL,
    "availableAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "reference" TEXT NOT NULL,
    "recordedBy" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbassadorEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorWithdrawal" (
    "id" TEXT NOT NULL,
    "ambassadorKind" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "waitingReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "stripeTransferId" TEXT,
    "failure" TEXT,

    CONSTRAINT "AmbassadorWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorAgreement_accountKind_accountId_key" ON "AmbassadorAgreement"("accountKind", "accountId");

-- CreateIndex
CREATE INDEX "Referral_referrerKind_referrerId_idx" ON "Referral"("referrerKind", "referrerId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_joinedKind_joinedId_key" ON "Referral"("joinedKind", "joinedId");

-- CreateIndex
CREATE INDEX "ReferralLevelReached_reachedAt_idx" ON "ReferralLevelReached"("reachedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLevelReached_referrerKind_referrerId_activeReferral_key" ON "ReferralLevelReached"("referrerKind", "referrerId", "activeReferrals");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorEntry_reference_key" ON "AmbassadorEntry"("reference");

-- CreateIndex
CREATE INDEX "AmbassadorEntry_ambassadorKind_ambassadorId_idx" ON "AmbassadorEntry"("ambassadorKind", "ambassadorId");

-- CreateIndex
CREATE INDEX "AmbassadorEntry_partnerShopId_idx" ON "AmbassadorEntry"("partnerShopId");

-- CreateIndex
CREATE INDEX "AmbassadorEntry_orderId_idx" ON "AmbassadorEntry"("orderId");

-- CreateIndex
CREATE INDEX "AmbassadorWithdrawal_ambassadorKind_ambassadorId_idx" ON "AmbassadorWithdrawal"("ambassadorKind", "ambassadorId");

-- CreateIndex
CREATE INDEX "AmbassadorWithdrawal_status_idx" ON "AmbassadorWithdrawal"("status");

-- CreateIndex
CREATE INDEX "PartnerShop_ambassadorKind_ambassadorId_idx" ON "PartnerShop"("ambassadorKind", "ambassadorId");

-- The referrals already made, through a Shopper's, a Runner's, a shop's or an organisation's
-- link, kept on the account that joined: each becomes a Referral row. Nobody is counted twice,
-- and nobody as referring themselves.
INSERT INTO "Referral" ("id", "referrerKind", "referrerId", "joinedKind", "joinedId", "via", "createdAt")
SELECT 'ref_s_' || s."id", 'shopper', r."id", 'shopper', s."id", s."joinedVia", s."createdAt"
FROM "Shopper" s
JOIN "Shopper" r ON s."joinedVia" = 'shopper:' || r."handle"
WHERE r."id" <> s."id" AND r."phone" <> s."phone"
ON CONFLICT DO NOTHING;

INSERT INTO "Referral" ("id", "referrerKind", "referrerId", "joinedKind", "joinedId", "via", "createdAt")
SELECT 'ref_s_' || s."id", 'runner', r."id", 'shopper', s."id", s."joinedVia", s."createdAt"
FROM "Shopper" s
JOIN "Runner" r ON s."joinedVia" = 'runner:' || r."referralCode"
WHERE r."phone" <> s."phone"
ON CONFLICT DO NOTHING;

INSERT INTO "Referral" ("id", "referrerKind", "referrerId", "joinedKind", "joinedId", "via", "createdAt")
SELECT 'ref_s_' || s."id", 'partner', p."id", 'shopper', s."id", s."joinedVia", s."createdAt"
FROM "Shopper" s
JOIN "PartnerShop" p ON s."joinedVia" = 'partner:' || p."id"
ON CONFLICT DO NOTHING;

INSERT INTO "Referral" ("id", "referrerKind", "referrerId", "joinedKind", "joinedId", "via", "createdAt")
SELECT 'ref_s_' || s."id", 'organisation', o."id", 'shopper', s."id", s."joinedVia", s."createdAt"
FROM "Shopper" s
JOIN "Organisation" o ON s."joinedVia" = 'organisation:' || o."joinCode"
ON CONFLICT DO NOTHING;

INSERT INTO "Referral" ("id", "referrerKind", "referrerId", "joinedKind", "joinedId", "via", "createdAt")
SELECT 'ref_r_' || n."id", 'runner', r."id", 'runner', n."id", 'runner:' || r."referralCode", n."createdAt"
FROM "Runner" n
JOIN "Runner" r ON n."referredBy" = r."referralCode"
WHERE r."id" <> n."id"
ON CONFLICT DO NOTHING;
