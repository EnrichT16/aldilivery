-- A Runner asking the Shopper about something they cannot find.
--
-- The question goes to the Shopper's screen and the answer back to the Runner's, so no phone
-- numbers change hands. Additive only: one new type and one new table, nothing altered. Deleting
-- an order or an item deletes its questions.
--
-- As with every migration here: no CREATE SCHEMA, ever. The managed database user is not a
-- superuser and that statement fails with SQLSTATE 42501.

-- CreateEnum
CREATE TYPE "ItemAnswer" AS ENUM ('similar', 'leave_out');

-- CreateTable
CREATE TABLE "ItemQuestion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answer" "ItemAnswer",
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ItemQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemQuestion_orderId_idx" ON "ItemQuestion"("orderId");

-- AddForeignKey
ALTER TABLE "ItemQuestion" ADD CONSTRAINT "ItemQuestion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemQuestion" ADD CONSTRAINT "ItemQuestion_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

