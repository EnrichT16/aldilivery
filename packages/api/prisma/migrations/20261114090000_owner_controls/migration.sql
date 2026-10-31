-- The owner's controls (Anthony, 31 October 2026, ruling 85). Additive only.
--
-- * StaffSighting: each staff sign-in and spell of activity, with a keyed one-way code of the
--   internet address, a rough place from the platform's own header, and the kind of device.
--   Kept 90 days (admin.staffSightingsKeepDays), then swept away.
-- * EmailSummary: a short spoken summary of each email from any of the mailboxes, for the owner
--   to listen to; the start of its words with numbers, codes and addresses blanked; never an
--   attachment. Kept 30 days (emailDesk.summaryKeepDays).
-- * OwnerPreference: how Ozi reaches the owner for each kind of matter, and his quiet hours.
-- * OwnerMatter: which alert choice a matter follows, and when a text or notification went.

-- AlterTable
ALTER TABLE "OwnerMatter" ADD COLUMN "alertKind" TEXT,
ADD COLUMN "alertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StaffSighting" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event" TEXT NOT NULL DEFAULT 'activity',
    "ipHash" TEXT NOT NULL,
    "place" TEXT,
    "userAgentKind" TEXT NOT NULL DEFAULT 'other',

    CONSTRAINT "StaffSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSummary" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mailbox" INTEGER NOT NULL DEFAULT 1,
    "mailboxLabel" TEXT NOT NULL,
    "fromName" TEXT,
    "replyTo" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "heard" BOOLEAN NOT NULL DEFAULT false,
    "heardAt" TIMESTAMP(3),
    "excerpt" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerPreference" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "urgentSafety" TEXT NOT NULL DEFAULT 'call',
    "importantEmail" TEXT NOT NULL DEFAULT 'call',
    "otherEmail" TEXT NOT NULL DEFAULT 'none',
    "approvals" TEXT NOT NULL DEFAULT 'call',
    "money" TEXT NOT NULL DEFAULT 'call',
    "quietFrom" TEXT NOT NULL,
    "quietUntil" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OwnerPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffSighting_staffId_at_idx" ON "StaffSighting"("staffId", "at");

-- CreateIndex
CREATE INDEX "StaffSighting_at_idx" ON "StaffSighting"("at");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSummary_messageId_key" ON "EmailSummary"("messageId");

-- CreateIndex
CREATE INDEX "EmailSummary_receivedAt_idx" ON "EmailSummary"("receivedAt");

-- CreateIndex
CREATE INDEX "EmailSummary_heard_receivedAt_idx" ON "EmailSummary"("heard", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPreference_key_key" ON "OwnerPreference"("key");
