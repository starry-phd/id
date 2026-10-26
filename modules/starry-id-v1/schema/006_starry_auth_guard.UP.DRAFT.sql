-- AI-1 R6 additional read-authorization indexes: SQLite/D1 logical DRAFT.
-- Use only in a disposable SQLite-memory test until AI-0 approves migration.
-- Depends on 001 and 003 (and can follow 005). No new business data.
BEGIN IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_starry_r6_identity_owner
  ON starry_identities(s_user_id,provider,subject);
CREATE INDEX IF NOT EXISTS idx_starry_r6_session_current
  ON starry_sessions(s_user_id,app_id,environment,auth_version,expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_starry_r6_oauth_pending_expiry
  ON starry_oauth_attempts(expires_at,app_id,environment)
  WHERE consumed_at IS NULL;
COMMIT;
