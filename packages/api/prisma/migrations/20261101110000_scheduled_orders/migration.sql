-- Ordering now for a later day (23 October 2026, ruling 78). An order may be booked for a UK day
-- (YYYY-MM-DD) up to 28 days ahead, in a window (morning, afternoon or evening), and is offered
-- to Runners only at its offer time (the window's start less the lead time). The money is taken
-- now, at a moment the Shopper chose (tried again every hour up to a number of tries), or by
-- bank transfer before the day. A link is sent when the bank asks the Shopper to check it is
-- them; an order still unpaid at its offer time is held; and the Shopper's reminders are kept.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryDay" TEXT,
ADD COLUMN     "deliveryWindow" TEXT,
ADD COLUMN     "offerAt" TIMESTAMP(3),
ADD COLUMN     "chargePlan" TEXT,
ADD COLUMN     "chargeAt" TIMESTAMP(3),
ADD COLUMN     "chargeTries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "chargeNextTryAt" TIMESTAMP(3),
ADD COLUMN     "chargeStatus" TEXT,
ADD COLUMN     "chargeLinkSentAt" TIMESTAMP(3),
ADD COLUMN     "scheduledHeldAt" TIMESTAMP(3),
ADD COLUMN     "reminderDayBeforeAt" TIMESTAMP(3),
ADD COLUMN     "reminderMorningAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_deliveryDay_idx" ON "Order"("deliveryDay");
