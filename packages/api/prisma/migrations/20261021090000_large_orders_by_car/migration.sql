-- Large orders go to Runners with a car (ruling 59, Anthony, 10 October 2026).
--
-- An order whose shopping at shop prices is over dispatch.carOnlyAbovePence (£60) is offered only
-- to a Runner delivering by car or van with in-date insurance. If none takes it, the owner is
-- texted once after dispatch.waitingAlertMinutes; this records when, so it is sent once only.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "waitingAlertSentAt" TIMESTAMP(3);
