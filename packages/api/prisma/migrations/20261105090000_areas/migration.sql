-- Areas, Runner location and the last checks before a job (Anthony, 30 October 2026). Ozi runs
-- across the whole UK, area by area: an area is a UK postcode area, and opens by itself once it
-- has an approved Runner and a shop. Staff can pause an area. A Shopper in an area not running
-- yet goes on its waiting list, and is texted once when it starts. Postcodes are turned into
-- places with postcodes.io once, and kept.
--
-- A Runner gives their home postcode, which gives their area; their phone shares where they are
-- while on shift, and when it last did is kept. Nobody is offered a job until their face photo
-- has been accepted, as the Runner agreement says, so that is kept on the Runner too, filled in
-- here from the face photos already accepted. The Runner's tick to say they are 18 or over is
-- kept with its time. An organisation may give its postcode.

-- AlterTable
ALTER TABLE "Runner" ADD COLUMN "homePostcode" TEXT NOT NULL DEFAULT '',
ADD COLUMN "locationAt" TIMESTAMP(3),
ADD COLUMN "facePhotoAcceptedAt" TIMESTAMP(3),
ADD COLUMN "adultConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN "postcode" TEXT NOT NULL DEFAULT '';

-- Face photos accepted before today count: the latest decision on each Runner's face photo.
UPDATE "Runner" AS r
SET "facePhotoAcceptedAt" = d."decidedAt"
FROM (
    SELECT DISTINCT ON ("runnerId") "runnerId", "status", COALESCE("reviewedAt", "createdAt") AS "decidedAt"
    FROM "RunnerDocument"
    WHERE "kind" = 'face_photo' AND "status" <> 'submitted'
    ORDER BY "runnerId", COALESCE("reviewedAt", "createdAt") DESC
) AS d
WHERE d."runnerId" = r."id" AND d."status" = 'accepted';

-- CreateTable
CREATE TABLE "PostcodePlace" (
    "id" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "found" BOOLEAN NOT NULL DEFAULT false,
    "lookedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostcodePlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "pausedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaWaiting" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "postcode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "textedAt" TIMESTAMP(3),

    CONSTRAINT "AreaWaiting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostcodePlace_postcode_key" ON "PostcodePlace"("postcode");

-- CreateIndex
CREATE UNIQUE INDEX "Area_area_key" ON "Area"("area");

-- CreateIndex
CREATE UNIQUE INDEX "AreaWaiting_area_shopperId_key" ON "AreaWaiting"("area", "shopperId");

-- CreateIndex
CREATE INDEX "AreaWaiting_area_textedAt_idx" ON "AreaWaiting"("area", "textedAt");
