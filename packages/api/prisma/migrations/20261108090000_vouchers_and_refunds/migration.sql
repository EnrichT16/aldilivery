-- Partner mark-ups, sent vouchers and orders no Runner takes (Anthony, 30 October 2026).
--
-- Mark-up: a partner, a restaurant or a grocery shop, may have an agreed mark-up on its prices,
-- set by staff, 0 for none. Shoppers see and pay the shop price with it on; the Runner pays the
-- shop price less any discount at the counter. Each partner thing in an order keeps its shop
-- price and its counter price as they were when the order was placed.
--
-- Referral reward vouchers staff send: one a level reached, the code (emptied when the account
-- is erased), the inbox message it went in, who sent it and when, when it was first opened and
-- when the person said they used it, and Ozi's reminder calls.
--
-- Orders no Runner takes are cancelled with a full refund through the existing cancellation, so
-- they need nothing new here.

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "agreedMarkupPercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "shopPricePence" INTEGER,
ADD COLUMN "counterPricePence" INTEGER;

-- CreateTable
CREATE TABLE "ReferralVoucher" (
    "id" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rewardPence" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "link" TEXT,
    "messageId" TEXT,
    "sentById" TEXT,
    "sentByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "nextReminderAt" TIMESTAMP(3),
    "ringingUntil" TIMESTAMP(3),
    "reminder1At" TIMESTAMP(3),
    "reminder1Via" TEXT,
    "reminder2At" TIMESTAMP(3),
    "reminder2Via" TEXT,
    "reminder3At" TIMESTAMP(3),
    "reminder3Via" TEXT,
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralVoucher_levelId_key" ON "ReferralVoucher"("levelId");

-- CreateIndex
CREATE INDEX "ReferralVoucher_accountKind_accountId_idx" ON "ReferralVoucher"("accountKind", "accountId");

-- CreateIndex
CREATE INDEX "ReferralVoucher_nextReminderAt_idx" ON "ReferralVoucher"("nextReminderAt");
