-- The admin panel's audit log, two-step codes for every staff sign-in, and why an order was
-- cancelled (Section Q, docs/STILL_TO_DO.md items 12 to 14).

-- Why an order was cancelled, in plain words, for the cancellations list.
ALTER TABLE "Order" ADD COLUMN     "cancelReason" TEXT;

-- Two-step recovery codes, each hashed, for a lost phone.
ALTER TABLE "StaffMember" ADD COLUMN     "recoveryCodes" TEXT NOT NULL DEFAULT '';

-- Who did what in the admin panel, and when.
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEntry_at_idx" ON "AuditEntry"("at");

CREATE INDEX "AuditEntry_actorId_idx" ON "AuditEntry"("actorId");

-- The audit log is only ever added to. The server has no way to change or remove an entry;
-- this makes the database itself refuse to as well, whoever asks, so a record cannot be
-- quietly edited or deleted even by someone who gets hold of the database password.
CREATE FUNCTION "audit_entry_is_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is only ever added to: entries cannot be changed or removed.';
END;
$$;

CREATE TRIGGER "AuditEntry_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "AuditEntry"
FOR EACH ROW EXECUTE FUNCTION "audit_entry_is_append_only"();

CREATE TRIGGER "AuditEntry_no_truncate"
BEFORE TRUNCATE ON "AuditEntry"
FOR EACH STATEMENT EXECUTE FUNCTION "audit_entry_is_append_only"();
