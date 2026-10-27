-- ONLY in a disposable offline database; deleting actual tombstones is
-- a legally gated operation, not a migration cleanup.
BEGIN IMMEDIATE;
DROP TRIGGER IF EXISTS trg_r15_auth_outbox_insert_verified;
DROP TRIGGER IF EXISTS trg_r15_auth_outbox_no_delete;
DROP TRIGGER IF EXISTS trg_r15_auth_outbox_no_update;
COMMIT;
