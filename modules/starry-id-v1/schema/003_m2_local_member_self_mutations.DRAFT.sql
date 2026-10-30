-- AI-1 M2 LOCAL-ONLY source-side mutation audit. DRAFT, NOT a production migration.
-- Applied *after* 001_starry_identity.DRAFT.sql in a physically Starry-only
-- development/staging SQLite authority. Never run against Echo/other D1.
-- Triggered audit and source UPDATE are ONE SQLite statement/transaction.
-- This avoids a "batch changes=0 but later audit insert committed" anomaly.
CREATE TABLE IF NOT EXISTS starry_m2_member_mutation_audit (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('profile_updated','session_revoked')),
  s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
  session_id TEXT,
  app_id TEXT NOT NULL CHECK(app_id='starry-id'),
  -- Profile row has no env column: NULL means derive from this D1's
  -- approved physical environment mapping. Never infer staging/prod in code.
  environment TEXT CHECK(environment IN ('development','staging')),
  profile_revision INTEGER CHECK(profile_revision IS NULL OR profile_revision>=1),
  created_at INTEGER NOT NULL CHECK(created_at>=0)
);
CREATE INDEX IF NOT EXISTS idx_starry_m2_member_audit_member
  ON starry_m2_member_mutation_audit(s_user_id,created_at);

CREATE TRIGGER IF NOT EXISTS starry_m2_profile_update_audit
AFTER UPDATE OF profile_revision ON starry_members
WHEN NEW.profile_revision = OLD.profile_revision+1
BEGIN
  INSERT INTO starry_m2_member_mutation_audit
    (event_id,event_type,s_user_id,session_id,app_id,environment,profile_revision,created_at)
  VALUES
    ('m2-profile-' || NEW.s_user_id || '-' || NEW.profile_revision,
     'profile_updated',NEW.s_user_id,NULL,'starry-id',NULL,
     NEW.profile_revision,NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS starry_m2_session_revoked_audit
AFTER UPDATE OF revoked_at ON starry_sessions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  INSERT INTO starry_m2_member_mutation_audit
    (event_id,event_type,s_user_id,session_id,app_id,environment,profile_revision,created_at)
  VALUES
    ('m2-revoke-' || NEW.session_id,'session_revoked',NEW.s_user_id,
     NEW.session_id,NEW.app_id,NEW.environment,NULL,NEW.revoked_at);
END;

-- Audit stores neither display_name nor bearer/refresh/provider identifiers.
-- Trigger failure (collision/FK/SQL) ABORTs source change in the SAME statement.
-- Physical D1 env, future outbox/ACK, retention and anti-PITR are separate Gates.
