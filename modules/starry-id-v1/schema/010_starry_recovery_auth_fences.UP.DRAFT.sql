-- AI-1 R10, OFFLINE/disposable SQLite :memory: ONLY.
-- This table/triggers live IN THE SAME DB as Auth and will also roll back in
-- PITR. They are NOT an external monotonic trust root. An independently
-- attested append-only checkpoint is required before any restore review.
-- Depends on 001, 007 and 008 (never run on live D1 without AI-0 Gate).
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS starry_auth_recovery_fence(
 realm TEXT PRIMARY KEY CHECK(realm='starry'),
 deleted_members INTEGER NOT NULL CHECK(deleted_members>=0),
 revoked_sessions INTEGER NOT NULL CHECK(revoked_sessions>=0),
 claimed_registration_gifts INTEGER NOT NULL CHECK(claimed_registration_gifts>=0)
);
INSERT OR IGNORE INTO starry_auth_recovery_fence
 (realm,deleted_members,revoked_sessions,claimed_registration_gifts)
 SELECT 'starry',
  (SELECT COUNT(*) FROM starry_members WHERE status='deleted'),
  (SELECT COUNT(*) FROM starry_sessions WHERE revoked_at IS NOT NULL),
  (SELECT COUNT(*) FROM starry_first_gift_claims);
CREATE TRIGGER IF NOT EXISTS trg_starry_r10_deleted_fence
 AFTER UPDATE OF status ON starry_members
 WHEN OLD.status<>'deleted' AND NEW.status='deleted'
 BEGIN
 UPDATE starry_auth_recovery_fence
 SET deleted_members=deleted_members+1 WHERE realm='starry';
 END;
CREATE TRIGGER IF NOT EXISTS trg_starry_r10_session_fence
 AFTER UPDATE OF revoked_at ON starry_sessions
 WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
 BEGIN
 UPDATE starry_auth_recovery_fence
 SET revoked_sessions=revoked_sessions+1 WHERE realm='starry';
 END;
CREATE TRIGGER IF NOT EXISTS trg_starry_r10_gift_fence
 AFTER INSERT ON starry_first_gift_claims
 BEGIN
 UPDATE starry_auth_recovery_fence
 SET claimed_registration_gifts=claimed_registration_gifts+1 WHERE realm='starry';
 END;
CREATE TRIGGER IF NOT EXISTS trg_starry_r10_no_rewind
 BEFORE UPDATE ON starry_auth_recovery_fence
 WHEN NEW.deleted_members<OLD.deleted_members OR
      NEW.revoked_sessions<OLD.revoked_sessions OR
      NEW.claimed_registration_gifts<OLD.claimed_registration_gifts
 BEGIN SELECT RAISE(ABORT,'STARRY_AUTH_FENCE_REWIND_DENIED'); END;
CREATE TRIGGER IF NOT EXISTS trg_starry_r10_no_delete
 BEFORE DELETE ON starry_auth_recovery_fence
 BEGIN SELECT RAISE(ABORT,'STARRY_AUTH_FENCE_DELETE_DENIED'); END;
COMMIT;
