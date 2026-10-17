-- Ozi's memory (17 October 2026, ruling 68): every exchange with Ozi on every channel, what was
-- heard and what was said, which part of Ozi answered, how it went, and a person's verdict.
-- Numbers, emails, postcodes and codes are blanked before a row is written; the conversation is
-- a one-way code, never a telephone number.
CREATE TABLE "OziExchange" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "turn" INTEGER NOT NULL DEFAULT 0,
    "heard" TEXT NOT NULL,
    "said" TEXT NOT NULL,
    "brain" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "verdict" TEXT NOT NULL DEFAULT 'unrated',
    "betterReply" TEXT,
    "ratedBy" TEXT,
    "ratedAt" TIMESTAMP(3),
    CONSTRAINT "OziExchange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OziExchange_at_idx" ON "OziExchange"("at");
CREATE INDEX "OziExchange_verdict_at_idx" ON "OziExchange"("verdict", "at");
CREATE INDEX "OziExchange_channel_at_idx" ON "OziExchange"("channel", "at");
