-- The owner's account, family and investor access, and the money ledger (7 October 2026).
ALTER TABLE "StaffMember" ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StaffMember" ADD COLUMN "passcodeHash" TEXT;
ALTER TABLE "StaffMember" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "StaffMember" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StaffMember" ADD COLUMN "allowedAreas" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StaffMember" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "IncomeRecord" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gateway" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    CONSTRAINT "IncomeRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncomeRecord_at_idx" ON "IncomeRecord"("at");
