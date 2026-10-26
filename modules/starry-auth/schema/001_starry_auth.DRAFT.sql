-- Starry-only AI-1 schema candidate. DO NOT APPLY TO ANY REMOTE D1.
PRAGMA foreign_keys=ON;
CREATE TABLE starry_members(
 s_user_id TEXT PRIMARY KEY NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
 auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version>=1),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE starry_oidc_identities(
 provider TEXT NOT NULL CHECK(provider IN ('google','apple')),
 provider_subject TEXT NOT NULL,
 s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,PRIMARY KEY(provider,provider_subject));
CREATE TABLE starry_sessions(
 session_id TEXT PRIMARY KEY NOT NULL,
 s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id) ON DELETE CASCADE,
 app_id TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 auth_version INTEGER NOT NULL,refresh_hash TEXT NOT NULL UNIQUE,
 refresh_version INTEGER NOT NULL DEFAULT 1 CHECK(refresh_version>=1),
 expires_at INTEGER NOT NULL,revoked_at INTEGER,step_up_until INTEGER,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX starry_sessions_by_user ON starry_sessions(s_user_id,revoked_at);
CREATE TABLE starry_admin_grants(
 grant_id TEXT PRIMARY KEY NOT NULL,
 s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id) ON DELETE CASCADE,
 app_id TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 resource TEXT NOT NULL CHECK(resource IN ('member','session','admin','billing','battery','system')),
 action TEXT NOT NULL CHECK(action IN ('read','write','approve','refund','deploy','export','restore')),
 expires_at INTEGER NOT NULL,revoked_at INTEGER,created_at INTEGER NOT NULL);
CREATE INDEX starry_grant_lookup ON starry_admin_grants(s_user_id,app_id,environment,resource,action,revoked_at);
-- Refresh CAS: one atomic UPDATE, require affected rows=1 before any new token.
-- UPDATE starry_sessions SET refresh_hash=:new_hash,refresh_version=refresh_version+1,updated_at=:now
-- WHERE session_id=:sid AND refresh_hash=:old_hash AND refresh_version=:version
-- AND revoked_at IS NULL AND expires_at>:now;
-- Distinguish proven replay from random invalid guess before family revocation.
