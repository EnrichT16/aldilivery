-- Anthony's new pricing (9 October 2026, ruling 58). docs/changes/pricing.md.
--
-- Shoppers: the monthly plans (Ozi Membership, Ozi Plus, Ozi Family and Carer) replace the
-- 30-day Plus that never renewed. "plusUntil" becomes "planUntil" (the plan is paid up until
-- then) and "plusFamily" becomes the plan's name. A plan renews monthly only when the Shopper
-- chose so ("planRenews"); nobody already on the old Plus is renewed: it runs out as before.
-- The old Plus (Recipes and Finds It, no delivery change) becomes Membership for what is left of
-- it; the old family plan becomes Family and Carer for what is left of it. Every Shopper has a
-- first month of membership free from sign-up, with pay-as-you-go delivery.
-- Orders: the item charges, which delivery price applied, and, on a Family and Carer plan, who
-- pays and whether the payer has approved an order above their limit.

-- AlterTable
ALTER TABLE "Shopper" RENAME COLUMN "plusUntil" TO "planUntil";

ALTER TABLE "Shopper" ADD COLUMN     "plan" TEXT,
ADD COLUMN     "planRenews" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "planStartedAt" TIMESTAMP(3),
ADD COLUMN     "planCancelledAt" TIMESTAMP(3),
ADD COLUMN     "freeMonthUntil" TIMESTAMP(3),
ADD COLUMN     "freeMonthReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "checkInSentAt" TIMESTAMP(3),
ADD COLUMN     "approvalLimitPence" INTEGER,
ADD COLUMN     "weeklySummarySentAt" TIMESTAMP(3);

UPDATE "Shopper" SET "plan" = CASE
    WHEN "plusFamily" OR "familyOwnerId" IS NOT NULL THEN 'family'
    ELSE 'membership'
  END
  WHERE "planUntil" IS NOT NULL;

UPDATE "Shopper" SET "freeMonthUntil" = "createdAt" + INTERVAL '1 month';

ALTER TABLE "Shopper" DROP COLUMN "plusFamily";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "itemChargesPence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryPlan" TEXT NOT NULL DEFAULT 'payg',
ADD COLUMN     "payerShopperId" TEXT,
ADD COLUMN     "approvalStatus" TEXT;
