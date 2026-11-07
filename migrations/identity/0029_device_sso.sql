-- Device single sign-on: one record per "this device is signed in as this member".
-- Apps on the same phone share the token (shared keychain) and exchange it for their own session.
CREATE TABLE device_sso (
  sso_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  session_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_device_sso_user ON device_sso (user_id);
ALTER TABLE sessions ADD COLUMN sso_id TEXT;
CREATE INDEX idx_sessions_sso ON sessions (sso_id);
