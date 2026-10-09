-- Runners are paid back for the shopping, and agree to the Runner agreement before their
-- first job (9 October 2026, ruling 55).

-- The Runner agreement: when, which version, and how it was agreed.
ALTER TABLE "Runner" ADD COLUMN     "agreementAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "agreementChannel" TEXT,
ADD COLUMN     "agreementVersion" TEXT;

-- Paying the Runner back for the shopping, recorded on the order.
ALTER TABLE "Order" ADD COLUMN     "reimbursedAt" TIMESTAMP(3),
ADD COLUMN     "reimbursementApprovedBy" TEXT,
ADD COLUMN     "reimbursementPence" INTEGER,
ADD COLUMN     "reimbursementReason" TEXT,
ADD COLUMN     "reimbursementStatus" TEXT,
ADD COLUMN     "reimbursementTransferId" TEXT;

CREATE INDEX "Order_reimbursementStatus_idx" ON "Order"("reimbursementStatus");
