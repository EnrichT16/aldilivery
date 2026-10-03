-- Each Shopper gets a customer at Stripe, so a saved card can be charged more than once.
-- Adds one nullable column; changes nothing that exists.

-- AlterTable
ALTER TABLE "Shopper" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Shopper_stripeCustomerId_key" ON "Shopper"("stripeCustomerId");

