-- Ozi knows the owner on his own phone (Anthony, 31 October 2026, ruling 84). Additive only.
--
-- * "Remember me on this phone": a staff session kept on a person's own phone carries this
--   number, and "Sign out of this phone" raises it, so every remembered phone of that account is
--   signed out at once. Sessions on other devices, and the kill switch, are unchanged.

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN "rememberedVersion" INTEGER NOT NULL DEFAULT 0;
