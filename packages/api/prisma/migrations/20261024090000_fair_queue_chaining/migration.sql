-- Ruling 64 (Anthony, 16 October 2026): the fair queue sharpened. A Runner on the final leg of a
-- job may be offered the next job whose pickup is within dispatch.chainRadiusMiles of their
-- drop-off, before it goes to the general queue, and may decline without penalty. Such an offer
-- is marked, so the Runner's app can say it is the job next door, and so it is never counted
-- against them. Earned-today balance, the distance bands and the queue position need no columns:
-- they are worked out from the orders, payouts and offers already kept.

-- AlterTable
ALTER TABLE "JobOffer" ADD COLUMN     "chained" BOOLEAN NOT NULL DEFAULT false;
