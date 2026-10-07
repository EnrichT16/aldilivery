-- Paying by bank transfer to the business account (7 October 2026, ruling 50).
ALTER TABLE "Order" ADD COLUMN "paidBy" TEXT NOT NULL DEFAULT 'card';
ALTER TABLE "Order" ADD COLUMN "bankReference" TEXT;
ALTER TABLE "Order" ADD COLUMN "bankReceivedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Order_bankReference_key" ON "Order"("bankReference");
