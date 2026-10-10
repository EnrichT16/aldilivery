-- Ruling 60 (Anthony, 10 October 2026): carrying limits by way of travelling, split jobs, the
-- app store reviewers' demo sign-in, and Runners closing their account in the app.
--
-- Split jobs: an order no available Runner can carry, and that nobody who can has taken within
-- dispatch.splitAfterMinutes, is split by item into parts within what walking and cycling carry.
-- Each part is its own order row pointing at the whole order (splitParentId, splitPart of
-- splitOf); the whole order records when it was split (splitAt). Each part is unique by its
-- number within the whole order, so an order is never split twice.
--
-- Demo: the demo Shopper and Runner (isDemo) and their orders, which charge no card and reach
-- no Runner.
--
-- Runner closing: when a Runner who left had their personal details removed (erasedAt).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "splitAt" TIMESTAMP(3),
ADD COLUMN     "splitOf" INTEGER,
ADD COLUMN     "splitParentId" TEXT,
ADD COLUMN     "splitPart" INTEGER;

-- AlterTable
ALTER TABLE "Runner" ADD COLUMN     "erasedAt" TIMESTAMP(3),
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Shopper" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Order_splitParentId_splitPart_key" ON "Order"("splitParentId", "splitPart");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_splitParentId_fkey" FOREIGN KEY ("splitParentId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

