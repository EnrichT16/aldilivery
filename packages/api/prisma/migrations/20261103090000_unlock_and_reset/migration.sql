-- Unlocking anybody, and resetting a PIN or a password (24 October 2026, ruling 81). The owner,
-- and staff he chooses (a new permission on the staff account, given only by him in Team), may
-- unlock a Shopper's PIN, reset it, unlock a staff member, reset a staff member's password and
-- clear the limits on sign-in codes sent to an account's phone. Clearing those limits marks the
-- codes already sent, so they no longer count towards them; the codes themselves are kept.

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN "canUnlock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OneTimeCode" ADD COLUMN "limitClearedAt" TIMESTAMP(3);
