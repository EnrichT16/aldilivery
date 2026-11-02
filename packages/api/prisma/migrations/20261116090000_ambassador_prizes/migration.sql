-- Top Ambassador of the month and the first-business bonus (Anthony, 2 November 2026, ruling 91).
-- Additive only.
--
-- * AmbassadorPrize: one row a month, made once by the hourly sweep on or after the 1st of the
--   next month and never changed: the month (UK time), the winner (null when nobody had enough
--   confirmed, ordering businesses), how many they had, whether Ozi's net income from
--   Ambassador-brought businesses reached the bar, that net in pence, and when it was decided.
-- * AmbassadorEntry.kind gains the values "prize" and "first-business-bonus" (a text column; no
--   change to the table).

-- CreateTable
CREATE TABLE "AmbassadorPrize" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "winnerKind" TEXT,
    "winnerId" TEXT,
    "qualifyingBusinesses" INTEGER NOT NULL DEFAULT 0,
    "barMet" BOOLEAN NOT NULL DEFAULT false,
    "netPence" INTEGER NOT NULL DEFAULT 0,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbassadorPrize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorPrize_month_key" ON "AmbassadorPrize"("month");

-- CreateIndex
CREATE INDEX "AmbassadorPrize_winnerKind_winnerId_idx" ON "AmbassadorPrize"("winnerKind", "winnerId");
