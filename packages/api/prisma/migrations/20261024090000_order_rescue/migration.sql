-- Order rescue tools (16 October 2026 review): staff can give a goodwill refund of a stated
-- amount on an order. What has been given is added up here, so that with any complaint refunds
-- it never comes to more than the order cost.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "goodwillRefundedPence" INTEGER NOT NULL DEFAULT 0;
