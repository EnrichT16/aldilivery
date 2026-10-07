-- What Ozi was asked and could not answer, for a person to approve an answer (7 October 2026, ruling 49).
CREATE TABLE "LearnedPhrase" (
    "id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timesHeard" INTEGER NOT NULL DEFAULT 1,
    "firstHeardAt" TIMESTAMP(3) NOT NULL,
    "lastHeardAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "reply" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "LearnedPhrase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LearnedPhrase_account_text_key" ON "LearnedPhrase"("account", "text");
CREATE INDEX "LearnedPhrase_status_timesHeard_idx" ON "LearnedPhrase"("status", "timesHeard");
