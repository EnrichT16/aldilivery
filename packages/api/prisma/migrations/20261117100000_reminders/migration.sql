-- Reminders for everyone (Anthony, 3 November 2026, ruling 93). Additive only.
--
-- * Reminder: one row for each reminder somebody asked for, by voice or on the screen, for any
--   kind of account (shopper, runner, partner, organisation, staff, owner): its words (blanked of
--   anything like a number or an address), when it is due (UTC), how it repeats, how it is
--   delivered (notification, text or call), how it stands (scheduled, sent, heard, cancelled),
--   whether it was set for the quiet hours on purpose, and when it was sent and heard.

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "repeat" TEXT NOT NULL DEFAULT 'none',
    "channel" TEXT NOT NULL DEFAULT 'notification',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdVia" TEXT NOT NULL DEFAULT 'screen',
    "setInQuiet" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "heardAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_accountKind_accountId_dueAt_idx" ON "Reminder"("accountKind", "accountId", "dueAt");

-- CreateIndex
CREATE INDEX "Reminder_status_dueAt_idx" ON "Reminder"("status", "dueAt");
