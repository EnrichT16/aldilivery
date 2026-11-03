-- An individual Ambassador rate, set by the owner alone (Anthony, 3 November 2026, ruling 94).
-- Additive only.
--
-- * AmbassadorAgreement.shareMultiplier: the multiplier on every percentage share, 1 unless the
--   owner set one (1.5 is "3% where others earn 2%"), with when and by whom (rateSetAt,
--   rateSetBy). Applied to new shares from the moment it is set.
-- * AmbassadorEntry.shareMultiplier: the multiplier a share was worked at, kept with it, so a later
--   change of rate never recomputes a share already made.

-- AlterTable
ALTER TABLE "AmbassadorAgreement" ADD COLUMN "shareMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "rateSetAt" TIMESTAMP(3),
ADD COLUMN "rateSetBy" TEXT;

-- AlterTable
ALTER TABLE "AmbassadorEntry" ADD COLUMN "shareMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1;
