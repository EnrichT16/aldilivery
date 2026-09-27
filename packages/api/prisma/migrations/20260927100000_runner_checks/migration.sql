-- A record of every check a person makes on a Runner.
--
-- Until now the two flags on Runner, rightToWorkVerified and criminalRecordCheckVerified,
-- could be true or false with nothing saying who set them, when, or on the strength of what.
-- Nothing could set them at all, so no Runner could ever be offered a job. This adds the
-- record that the approval tool writes to whenever it sets or clears a flag.
--
-- Additive only: a new table and two new types, nothing altered or dropped. Deleting a Runner
-- deletes their checks with them.
--
-- As with every migration here: no CREATE SCHEMA, ever. The managed database user is not a
-- superuser and that statement fails with SQLSTATE 42501.

-- CreateEnum
CREATE TYPE "RunnerCheckKind" AS ENUM ('right_to_work', 'criminal_record');

-- CreateEnum
CREATE TYPE "RunnerCheckOutcome" AS ENUM ('verified', 'withdrawn');

-- CreateTable
CREATE TABLE "RunnerCheck" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "kind" "RunnerCheckKind" NOT NULL,
    "outcome" "RunnerCheckOutcome" NOT NULL,
    "evidence" TEXT NOT NULL,
    "checkedBy" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunnerCheck_runnerId_idx" ON "RunnerCheck"("runnerId");

-- AddForeignKey
ALTER TABLE "RunnerCheck" ADD CONSTRAINT "RunnerCheck_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

