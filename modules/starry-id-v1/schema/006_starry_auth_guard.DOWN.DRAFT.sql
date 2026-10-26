-- AI-1 R6 index-only rollback for disposable SQLite memory only.
-- Preserve all member, provider Identity, Session and OAuth Attempt rows.
BEGIN IMMEDIATE;
DROP INDEX IF EXISTS idx_starry_r6_oauth_pending_expiry;
DROP INDEX IF EXISTS idx_starry_r6_session_current;
DROP INDEX IF EXISTS idx_starry_r6_identity_owner;
COMMIT;
