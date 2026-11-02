-- Starry ID identity database, schema v1 (spec v2.0 S-ID-01..10, S-PLT-06).
-- All timestamps are Unix epoch milliseconds, UTC.
-- Members are matched only by provider + subject, never by email or name.

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'pending_deletion')),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  deletion_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  email TEXT,
  email_is_private_relay INTEGER NOT NULL DEFAULT 0 CHECK (email_is_private_relay IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX idx_auth_identities_user_provider ON auth_identities (user_id, provider);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  previous_refresh_token_hash TEXT,
  session_version INTEGER NOT NULL,
  device_label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_previous_hash ON sessions (previous_refresh_token_hash);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 50),
  avatar_key TEXT,
  birthday TEXT CHECK (birthday IS NULL OR birthday GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  locale TEXT NOT NULL DEFAULT 'zh-TW',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at INTEGER NOT NULL
);

CREATE TABLE consents (
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK (document IN ('terms', 'privacy')),
  version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  PRIMARY KEY (user_id, document, version)
);

CREATE TABLE user_roles (
  user_id TEXT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'support')),
  granted_at INTEGER NOT NULL,
  granted_by TEXT
);

-- No foreign key on actor/target: audit rows must outlive account deletion.
-- Never store tokens, secrets or raw personal data here.
CREATE TABLE audit_log (
  audit_id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  app_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'error')),
  request_id TEXT,
  retention_class TEXT NOT NULL CHECK (retention_class IN ('general', 'security'))
);
CREATE INDEX idx_audit_log_occurred ON audit_log (occurred_at);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id, occurred_at);
