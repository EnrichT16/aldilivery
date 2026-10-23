-- The company inbox and staff calls (23 October 2026, ruling 77). The company (the owner and
-- staff) can message any account and the account can reply: one thread for each account, and
-- every message with who sent it, when, when it was read, and what authorised it. Codes that
-- authorise staff to message and call are kept only as hashes. Every staff call is logged, with
-- its recording's place in storage while it is kept. The owner may let a staff member authorise.

CREATE TABLE "InboxThread" (
    "id" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxThread_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboxThread_accountKind_accountId_key" ON "InboxThread"("accountKind", "accountId");
CREATE INDEX "InboxThread_lastMessageAt_idx" ON "InboxThread"("lastMessageAt");

CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fromStaff" BOOLEAN NOT NULL,
    "staffId" TEXT,
    "senderName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'sent',
    "authorisedBy" TEXT,
    "authorisedByName" TEXT,
    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboxMessage_threadId_createdAt_idx" ON "InboxMessage"("threadId", "createdAt");
CREATE INDEX "InboxMessage_fromStaff_createdAt_idx" ON "InboxMessage"("fromStaff", "createdAt");
ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "InboxThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffContactCode" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "StaffContactCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffContactCode_staffId_kind_idx" ON "StaffContactCode"("staffId", "kind");

CREATE TABLE "StaffCall" (
    "id" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "staffId" TEXT,
    "staffName" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "authorisedBy" TEXT NOT NULL,
    "authorisedByName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "phoneRung" BOOLEAN NOT NULL DEFAULT false,
    "recordingStatus" TEXT NOT NULL DEFAULT 'none',
    "recordingKey" TEXT,
    "egressId" TEXT,
    "recordingNote" TEXT,
    CONSTRAINT "StaffCall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffCall_roomName_key" ON "StaffCall"("roomName");
CREATE INDEX "StaffCall_startedAt_idx" ON "StaffCall"("startedAt");
CREATE INDEX "StaffCall_accountKind_accountId_idx" ON "StaffCall"("accountKind", "accountId");

ALTER TABLE "StaffMember" ADD COLUMN "canAuthorise" BOOLEAN NOT NULL DEFAULT false;
