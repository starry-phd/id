-- AI-1 R15: disposable SQLite :memory: contract hardening only.
-- Existing source remains exactly: event_id,s_user_id,occurred_at,event_type.
-- Do not modify source to silently impersonate AI-2/AI-3 wire envelopes.
BEGIN IMMEDIATE;
CREATE TRIGGER IF NOT EXISTS trg_r15_auth_outbox_no_update
 BEFORE UPDATE ON starry_deletion_outbox
 BEGIN SELECT RAISE(ABORT,'AUTH_DELETION_OUTBOX_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_r15_auth_outbox_no_delete
 BEFORE DELETE ON starry_deletion_outbox
 BEGIN SELECT RAISE(ABORT,'AUTH_DELETION_OUTBOX_ERASURE_GATE'); END;
CREATE TRIGGER IF NOT EXISTS trg_r15_auth_outbox_insert_verified
 BEFORE INSERT ON starry_deletion_outbox
 BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM starry_members m WHERE m.s_user_id=NEW.s_user_id
    AND m.status='deleted' AND m.auth_version>=2
    AND m.updated_at=NEW.occurred_at AND m.display_name IS NULL
    AND m.directory_opt_in=0 AND m.display_name_public=0
 ) OR EXISTS(
  SELECT 1 FROM starry_sessions s WHERE s.s_user_id=NEW.s_user_id
    AND s.revoked_at IS NULL
 ) THEN RAISE(ABORT,'AUTH_DELETION_OUTBOX_NOT_COMMITTED') END;
 END;
COMMIT;
