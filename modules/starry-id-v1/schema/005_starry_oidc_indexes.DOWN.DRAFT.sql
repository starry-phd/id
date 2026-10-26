-- AI-1 Round5 rollback on a disposable SQLite copy ONLY, never live D1.
-- Index-only rollback: preserve members, sessions, identities and attempts.
BEGIN IMMEDIATE;
DROP INDEX IF EXISTS idx_starry_sessions_scope_active_v5;
DROP INDEX IF EXISTS idx_starry_oauth_pending_scope_v5;
COMMIT;
