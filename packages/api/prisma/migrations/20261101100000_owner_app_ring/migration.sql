-- Ozi rings the owner in the app first, then his mobile (23 October 2026, ruling 79). A device
-- where the owner allowed notifications in the admin panel is kept against his staff account,
-- in the same table as a Shopper's devices; one device can be both. Each call to the owner now
-- says whether it rang in the app first, when the phone was rung, where he answered, and
-- whether it was a test from My settings.

ALTER TABLE "PushSubscription" ALTER COLUMN "shopperId" DROP NOT NULL;
ALTER TABLE "PushSubscription" ADD COLUMN "staffId" TEXT;
CREATE INDEX "PushSubscription_staffId_idx" ON "PushSubscription"("staffId");

ALTER TABLE "OwnerCall" ADD COLUMN "appRingUntil" TIMESTAMP(3),
ADD COLUMN "phonePlacedAt" TIMESTAMP(3),
ADD COLUMN "answeredVia" TEXT,
ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;
