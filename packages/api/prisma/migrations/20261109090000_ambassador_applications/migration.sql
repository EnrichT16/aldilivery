-- Ozi Ambassador applications (Anthony, 30 October 2026).
--
-- Becoming an Ambassador is no longer instant. A person agrees to the Ambassador terms (applied),
-- sends a photo ID, a proof of address dated within the last 3 months and a face photo
-- (documents sent), the automatic check or staff accept them (documents checked), staff record a
-- short chat with the founder (chat done), and only then do the founder or staff approve them.
-- They may also be declined, with a reason they see, or suspended.
--
-- Everybody who agreed to the terms before this is grandfathered as "documents_needed": their
-- link keeps working and their earnings keep coming in, but the Toolkit and withdrawals wait until
-- they are approved. So the column is added with that as its default, for the rows already there,
-- and the default for new rows is then set to "applied".
--
-- The documents are kept while the person is an Ambassador and for 12 months after they stop
-- (or are declined), then the files are removed by the retention sweep.
--
-- A business an Ambassador signs up with the owner present ("Sign up this business now") keeps
-- the reference on its printed Shop Partner agreement sheet, checked by staff when they approve,
-- the mark-up and discount agreed (proposed until staff confirm them), and the name the owner
-- typed when agreeing.

-- AlterTable
ALTER TABLE "AmbassadorAgreement" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'documents_needed',
ADD COLUMN "idType" TEXT,
ADD COLUMN "documentsSentAt" TIMESTAMP(3),
ADD COLUMN "documentsCheckedAt" TIMESTAMP(3),
ADD COLUMN "chatDoneAt" TIMESTAMP(3),
ADD COLUMN "chatDoneBy" TEXT,
ADD COLUMN "chatNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN "decidedAt" TIMESTAMP(3),
ADD COLUMN "decidedBy" TEXT,
ADD COLUMN "decisionReason" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "stoppedAt" TIMESTAMP(3);

-- New applications start as "applied".
ALTER TABLE "AmbassadorAgreement" ALTER COLUMN "status" SET DEFAULT 'applied';

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "agreementReference" TEXT,
ADD COLUMN "proposedMarkupPercent" INTEGER,
ADD COLUMN "proposedDiscountPercent" INTEGER,
ADD COLUMN "ownerAgreedName" TEXT;

-- CreateTable
CREATE TABLE "AmbassadorDocument" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idType" TEXT,
    "addressType" TEXT,
    "image" BYTEA,
    "contentType" TEXT,
    "shareCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "checkedAt" TIMESTAMP(3),
    "checkPassed" BOOLEAN,
    "checkNote" TEXT,
    "checkName" TEXT,
    "checkIssuedOn" TEXT,
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "AmbassadorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmbassadorAgreement_status_idx" ON "AmbassadorAgreement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerShop_agreementReference_key" ON "PartnerShop"("agreementReference");

-- CreateIndex
CREATE INDEX "AmbassadorDocument_agreementId_idx" ON "AmbassadorDocument"("agreementId");

-- CreateIndex
CREATE INDEX "AmbassadorDocument_accountKind_accountId_idx" ON "AmbassadorDocument"("accountKind", "accountId");

-- CreateIndex
CREATE INDEX "AmbassadorDocument_status_idx" ON "AmbassadorDocument"("status");

-- AddForeignKey
ALTER TABLE "AmbassadorDocument" ADD CONSTRAINT "AmbassadorDocument_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "AmbassadorAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
