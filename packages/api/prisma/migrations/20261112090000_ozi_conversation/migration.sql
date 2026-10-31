-- Ozi's conversations (Anthony, 31 October 2026). Additive only.
--
-- * Each exchange in Ozi's memory keeps the exact model that answered (when the language model
--   did) and the kind of person speaking: shopper, runner, partner, organisation, staff, owner or
--   visitor. Both go into the owner's training export.
-- * When Ozi's weekly self-review looked at an exchange, so none is looked at twice.
-- * An index to read one conversation's last turns back, so Ozi follows the thread.
-- * A better answer Ozi suggests on the Learning list, for a person to approve; never used
--   until a person does.

-- AlterTable
ALTER TABLE "OziExchange" ADD COLUMN "model" TEXT,
ADD COLUMN "accountKind" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LearnedPhrase" ADD COLUMN "suggestedReply" TEXT,
ADD COLUMN "suggestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OziExchange_conversationKey_at_idx" ON "OziExchange"("conversationKey", "at");
