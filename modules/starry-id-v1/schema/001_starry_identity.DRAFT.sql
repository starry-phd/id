-- AI-1 Starry ID REBUILD v1.0.0-draft. Do NOT apply to production.
-- Physical D1 placement undecided by AI-0; logical Auth/Member owns these tables.
PRAGMA foreign_keys=ON;
CREATE TABLE starry_members(
  s_user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version>=1),
  profile_revision INTEGER NOT NULL DEFAULT 1 CHECK(profile_revision>=1),
  display_name TEXT,
  directory_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(directory_opt_in IN (0,1)),
  display_name_public INTEGER NOT NULL DEFAULT 0 CHECK(display_name_public IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Apple/Google stable provider subject only; NEVER unique on email or name.
CREATE TABLE starry_identities(
  provider TEXT NOT NULL CHECK(provider IN ('apple','google')),
  subject TEXT NOT NULL,
  s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
  PRIMARY KEY(provider,subject)
);
CREATE TABLE starry_sessions(
  session_id TEXT PRIMARY KEY,
  s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  auth_version INTEGER NOT NULL CHECK(auth_version>=1),
  refresh_hash TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  step_up_method TEXT CHECK(step_up_method IN ('passkey','totp')),
  step_up_verified_at INTEGER,
  step_up_expires_at INTEGER
);
CREATE INDEX idx_starry_sessions_member ON starry_sessions(s_user_id);
CREATE TABLE starry_admin_grants(
  grant_id TEXT PRIMARY KEY,
  s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  permission TEXT NOT NULL CHECK(permission IN ('member:suspend','member:restore')),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
-- Example future atomic operations (NOT deployed):
-- UPDATE starry_members SET display_name=?, profile_revision=profile_revision+1,
-- updated_at=? WHERE s_user_id=? AND profile_revision=? AND status='active';
-- Exactly 1 changed row required for success (no blind overwrite).
-- Logout/revocation: UPDATE starry_sessions SET revoked_at=? WHERE
-- session_id=? AND s_user_id=? AND revoked_at IS NULL;
-- After suspend/delete, bump member.auth_version and revoke ALL sessions
-- within the same transaction. AI-3 consumes approved redacted audit/outbox.
-- CAS refresh token rotation must use hash, previous hash, auth_version and
-- revoked/expiry checks atomically; never issue next token if changedRows != 1.
