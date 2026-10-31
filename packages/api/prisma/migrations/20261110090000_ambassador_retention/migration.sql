-- Declined, suspended and removed Ozi Ambassadors, consent to compare faces, and how long their
-- documents are kept (Anthony, 31 October 2026).
--
-- * The separate yes or no to comparing the face photo with the photo on the ID, and when it was
--   given. No answer, or no, means a person checks it; nobody is declined for saying no.
-- * A suspension ends lifted (back to the status kept in "suspendedFrom", held earnings released)
--   or removed for fraud (status "removed"): the unpaid part of the shares from the businesses
--   staff mark is cancelled, kept on each line with when and why.
-- * A declined application's ID, proof of address and face photo are removed 30 days after the
--   decline; a removed Ambassador's 12 months after. Only a short note stays (name, the name on
--   the ID, a date of birth if held, the date and the reason), removed after 12 months, except
--   the note that bars somebody removed for fraud, which stays.

-- AlterTable
ALTER TABLE "AmbassadorAgreement" ADD COLUMN "faceCompareConsent" BOOLEAN,
ADD COLUMN "faceCompareConsentAt" TIMESTAMP(3),
ADD COLUMN "suspendedFrom" TEXT,
ADD COLUMN "documentsRemovedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AmbassadorEntry" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledPence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cancelReason" TEXT;

-- CreateTable
CREATE TABLE "AmbassadorNote" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameOnId" TEXT,
    "dateOfBirth" TEXT,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleteAfter" TIMESTAMP(3),

    CONSTRAINT "AmbassadorNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmbassadorNote_accountKind_accountId_idx" ON "AmbassadorNote"("accountKind", "accountId");

-- CreateIndex
CREATE INDEX "AmbassadorNote_deleteAfter_idx" ON "AmbassadorNote"("deleteAfter");
