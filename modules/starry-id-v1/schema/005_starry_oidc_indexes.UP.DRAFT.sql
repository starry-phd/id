-- AI-1 Round5; apply ONLY to an empty disposable SQLite DB for offline CI.
-- Precondition: initial Starry drafts 001 and 003 present. 004 is comment-only.
-- Atomic index creation in one SQLite transaction; this is an executable forward
-- proposal, NOT a remotely approved Cloudflare D1 migration.
BEGIN IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_starry_oauth_pending_scope_v5
  ON starry_oauth_attempts(state,provider,app_id,environment,client_id,expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_starry_sessions_scope_active_v5
  ON starry_sessions(app_id,environment,s_user_id,expires_at)
  WHERE revoked_at IS NULL;
COMMIT;
