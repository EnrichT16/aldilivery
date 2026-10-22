-- Ozi's desk and the automatic check (22 October 2026, ruling 74). Ozi rings the owner about
-- anything that needs him: each matter, and each call placed about them, is kept here so the
-- escalation survives a restart. The automatic check records what it found on each Runner
-- document and shop product, and a Runner's agreement to the face comparison is kept on their
-- account.

CREATE TABLE "OwnerMatter" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decision" TEXT,
    "decidedVia" TEXT,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "laterUntil" TIMESTAMP(3),
    "callAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastCalledAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    CONSTRAINT "OwnerMatter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnerMatter_status_createdAt_idx" ON "OwnerMatter"("status", "createdAt");
CREATE INDEX "OwnerMatter_kind_subjectId_idx" ON "OwnerMatter"("kind", "subjectId");

CREATE TABLE "OwnerCall" (
    "id" TEXT NOT NULL,
    "cascade" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'placed',
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "matterCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OwnerCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnerCall_placedAt_idx" ON "OwnerCall"("placedAt");

ALTER TABLE "Runner" ADD COLUMN "faceMatchConsentAt" TIMESTAMP(3);

ALTER TABLE "RunnerDocument" ADD COLUMN "checkedAt" TIMESTAMP(3),
ADD COLUMN "checkPassed" BOOLEAN,
ADD COLUMN "checkNote" TEXT,
ADD COLUMN "checkName" TEXT;

ALTER TABLE "PartnerProduct" ADD COLUMN "checkedAt" TIMESTAMP(3),
ADD COLUMN "checkNote" TEXT;
