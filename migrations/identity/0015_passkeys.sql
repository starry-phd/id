-- Passkeys (WebAuthn) a member added to sign in to the web account center. Only the public key is stored.
CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY CHECK (length(credential_id) BETWEEN 16 AND 1024),
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  public_key TEXT NOT NULL CHECK (json_valid(public_key)),
  sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_passkeys_user ON passkeys (user_id);
