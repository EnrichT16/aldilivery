-- "I can't find this" rings the Shopper (Anthony, 2 November 2026, ruling 90). Additive only.
--
-- * ItemQuestion.answeredVia: how the Shopper answered: on their screen, by text, or by voice on
--   the call.
-- * ItemQuestion.callId, callAttempts, lastRangAt, callState: the Runner-started, free in-app
--   call the one tap rings, how many times the Shopper has been rung on it, and where it has got
--   to ("off" when calls are not switched on, "calling", "stopped", "unanswered").

-- AlterTable
ALTER TABLE "ItemQuestion" ADD COLUMN "answeredVia" TEXT,
ADD COLUMN "callId" TEXT,
ADD COLUMN "callAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRangAt" TIMESTAMP(3),
ADD COLUMN "callState" TEXT;
