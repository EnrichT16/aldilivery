-- Ozi reads the business mailbox (22 October 2026, ruling 76). Each email read is recorded once,
-- by its Message-ID, so nothing is read twice; only the sender's domain is kept. An email that
-- needs the owner becomes a matter on Ozi's desk, which now also keeps who it is from and its
-- subject for the admin panel.

CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromDomain" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "matterId" TEXT,
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailMessage_messageId_key" ON "EmailMessage"("messageId");
CREATE INDEX "EmailMessage_processedAt_idx" ON "EmailMessage"("processedAt");

ALTER TABLE "OwnerMatter" ADD COLUMN "emailFrom" TEXT,
ADD COLUMN "emailSubject" TEXT;
