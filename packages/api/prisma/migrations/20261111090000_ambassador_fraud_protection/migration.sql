-- Protections against Ozi Ambassadors misusing the name (Anthony, 31 October 2026). Additive only.
--
-- * Each approved Ambassador has a check code for the public "Check an Ambassador" page, which
--   every printed QR code goes through, so a suspension takes effect at once on paper.
-- * A business an Ambassador signs up confirms with a code sent to its own phone; the claim waits
--   until then ("AmbassadorClaim", with only a keyed hash of the code), and the first confirmed
--   claim wins. Businesses already tied to an Ambassador before today count as confirmed when
--   they joined, so nothing they earned changes.
-- * A share is held for a person to check when the order's Shopper matches the Ambassador or the
--   business owner.
-- * A random device id the app keeps, seen with each account, to spot an order from the
--   Ambassador's own device or the owner's ("DeviceSighting").
-- * "Were you promised anything that isn't in your agreement?", and the welcome text.

-- AlterTable
ALTER TABLE "AmbassadorAgreement" ADD COLUMN "checkCode" TEXT;

-- AlterTable
ALTER TABLE "AmbassadorEntry" ADD COLUMN "heldAt" TIMESTAMP(3),
ADD COLUMN "heldReason" TEXT;

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "ambassadorConfirmNeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ambassadorConfirmedAt" TIMESTAMP(3),
ADD COLUMN "promiseTextSentAt" TIMESTAMP(3),
ADD COLUMN "promiseAnswer" TEXT,
ADD COLUMN "promiseNote" TEXT,
ADD COLUMN "promiseAnsweredAt" TIMESTAMP(3),
ADD COLUMN "welcomeTextSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AmbassadorClaim" (
    "id" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "ambassadorKind" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeSentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "refusedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "AmbassadorClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSighting" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceSighting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSighting_deviceId_accountKind_accountId_key" ON "DeviceSighting"("deviceId", "accountKind", "accountId");

-- CreateIndex
CREATE INDEX "DeviceSighting_accountKind_accountId_idx" ON "DeviceSighting"("accountKind", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorAgreement_checkCode_key" ON "AmbassadorAgreement"("checkCode");

-- CreateIndex
CREATE INDEX "AmbassadorClaim_partnerShopId_idx" ON "AmbassadorClaim"("partnerShopId");

-- CreateIndex
CREATE INDEX "AmbassadorClaim_ambassadorKind_ambassadorId_idx" ON "AmbassadorClaim"("ambassadorKind", "ambassadorId");

-- Businesses tied to an Ambassador before today: confirmed when they joined. The "Were you
-- promised" question is for businesses joining from today, so theirs is marked "not_asked".
UPDATE "PartnerShop"
SET "ambassadorConfirmedAt" = "createdAt",
    "promiseAnswer" = 'not_asked',
    "promiseAnsweredAt" = CURRENT_TIMESTAMP
WHERE "ambassadorId" IS NOT NULL;
