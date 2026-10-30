-- Restaurant pricing, Ozi Preferred Partners and checkout insights (Anthony, 30 October 2026).
--
-- A restaurant, café or takeaway pays Ozi no commission any more. It may agree a discount for
-- Ozi instead: it sells to Ozi at its shop price less that percentage, set by staff, 0 for none.
-- At the configured percentage or more it is an Ozi Preferred Partner. An order from a restaurant
-- keeps which restaurant it is from and the discount agreed when it was placed, so the Runner
-- pays the discounted amount at the counter while the Shopper pays shop prices.
--
-- Checkout insights: the analysis rows gain the breakdown a Shopper was shown at checkout, the
-- kind of order, the no-Runner warning, new or returning, the way they ordered, and the answer to
-- "Can we ask what stopped you?". Never a card detail. Kept for 12 months (services/retention.ts).

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "agreedDiscountPercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "restaurantShopId" TEXT,
ADD COLUMN "restaurantDiscountPercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN "itemChargesPence" INTEGER,
ADD COLUMN "feePence" INTEGER,
ADD COLUMN "totalPence" INTEGER,
ADD COLUMN "restaurant" BOOLEAN,
ADD COLUMN "noRunnerWarning" BOOLEAN,
ADD COLUMN "returning" BOOLEAN,
ADD COLUMN "channel" TEXT,
ADD COLUMN "answer" TEXT;
