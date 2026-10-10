-- Ruling 61 (Anthony, 10 October 2026): the split cascade by vehicle. A large order nobody has
-- taken within dispatch.splitAfterMinutes is split for the fewest Runners possible, motorbike
-- riders first, then Runners on foot or bicycle. Each part records who it is for, so it is
-- offered only to Runners of that kind: "motorbike" (a motorbike rider, or a car or van Runner)
-- or "foot" (on foot or by bicycle). Null on a whole order and on parts split before ruling 61.
-- A part also records when it was planned (splitPlannedAt): if its kind of Runner goes off shift,
-- what nobody has taken is planned again only after another dispatch.splitAfterMinutes.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "splitMode" TEXT,
ADD COLUMN     "splitPlannedAt" TIMESTAMP(3);

-- Baskets over £150 (ruling 61): a basket kept whole goes as linked orders of up to £150 each,
-- sharing the first order's id (basketGroupId), each order basketPart of basketOf. On each linked
-- order after the first, where its extra Runner's £13.50 delivery has got to
-- (extraDeliveryStatus) and the card payment that took it (extraDeliveryPaymentId): it is taken
-- only when that order's Runner collects it, and given back, or kept as "Unused Runner fee
-- credit" (Shopper.unusedRunnerFeeCreditPence, part of creditPence), when that Runner is not used.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "basketGroupId" TEXT,
ADD COLUMN     "basketPart" INTEGER,
ADD COLUMN     "basketOf" INTEGER,
ADD COLUMN     "extraDeliveryStatus" TEXT,
ADD COLUMN     "extraDeliveryPaymentId" TEXT;

-- AlterTable
ALTER TABLE "Shopper" ADD COLUMN     "unusedRunnerFeeCreditPence" INTEGER NOT NULL DEFAULT 0;
