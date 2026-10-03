-- Runners (rulings of 2 October 2026): every way they might deliver, their own ID for the link
-- they share, who invited them, their licence and motor insurance as accepted by a person, the
-- documents they send in, and their feedback.
--
-- Written by hand rather than generated: Runners who already exist need an ID and their travel
-- mode carried over before the ID can be required.

ALTER TABLE "Runner" ADD COLUMN "drivingLicenceVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "motorInsuranceUntil" TIMESTAMP(3),
ADD COLUMN "referralCode" TEXT,
ADD COLUMN "referredBy" TEXT,
ADD COLUMN "travelModes" "VehicleType"[] DEFAULT ARRAY[]::"VehicleType"[];

-- Existing Runners: an ID made from their row, and the one way they travel now.
UPDATE "Runner" SET "referralCode" = 'R' || upper(substr(md5("id"), 1, 7)) WHERE "referralCode" IS NULL;
UPDATE "Runner" SET "travelModes" = ARRAY["vehicleType"] WHERE cardinality("travelModes") = 0;

ALTER TABLE "Runner" ALTER COLUMN "referralCode" SET NOT NULL;

-- CreateTable
CREATE TABLE "RunnerDocument" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "image" BYTEA,
    "contentType" TEXT,
    "shareCode" TEXT,
    "expiresOn" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunnerFeedback" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunnerDocument_runnerId_idx" ON "RunnerDocument"("runnerId");

-- CreateIndex
CREATE INDEX "RunnerDocument_status_idx" ON "RunnerDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Runner_referralCode_key" ON "Runner"("referralCode");

-- AddForeignKey
ALTER TABLE "RunnerDocument" ADD CONSTRAINT "RunnerDocument_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
