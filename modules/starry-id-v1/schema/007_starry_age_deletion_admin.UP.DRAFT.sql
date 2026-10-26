-- AI-1 Phase 7: DRAFT ONLY. Apply only to disposable SQLite in-memory CI.
-- Existing base 001 must already exist. No live Cloudflare D1 migration.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS starry_deletion_outbox(
 event_id TEXT PRIMARY KEY,
 s_user_id TEXT NOT NULL UNIQUE REFERENCES starry_members(s_user_id),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>=0),
 event_type TEXT NOT NULL CHECK(event_type='account_deleted')
);
-- One supreme manager per Starry environment. The protected user must
-- only be assigned through a future approved break-glass/2FA provisioning Gate.
CREATE TABLE IF NOT EXISTS starry_admin_roles(
 s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 role TEXT NOT NULL CHECK(role IN ('supreme','delegated')),
 revoked_at INTEGER,
 PRIMARY KEY(s_user_id,environment)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_starry_single_supreme
 ON starry_admin_roles(environment) WHERE role='supreme' AND revoked_at IS NULL;
COMMIT;
