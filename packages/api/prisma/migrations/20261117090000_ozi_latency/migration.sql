-- How long Ozi takes to answer (Anthony, 3 November 2026, ruling 92). Additive only.
--
-- * OziExchange gains four nullable timings in milliseconds: modelMs (waiting on the model),
--   firstWordMs (from the request to the first spoken sentence leaving the server), totalMs (the
--   whole server time) and feltMs (the delay the person felt on their phone, from finishing
--   speaking to the first word heard, sent back by the app after the turn).

-- AlterTable
ALTER TABLE "OziExchange" ADD COLUMN "modelMs" INTEGER,
ADD COLUMN "firstWordMs" INTEGER,
ADD COLUMN "totalMs" INTEGER,
ADD COLUMN "feltMs" INTEGER;
