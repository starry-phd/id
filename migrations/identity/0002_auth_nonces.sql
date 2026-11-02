-- Server-issued, single-use login nonces (spec S-ID-01).
-- The App passes the nonce to Apple or Google; the ID token must carry it back.

CREATE TABLE auth_nonces (
  nonce TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_auth_nonces_expires ON auth_nonces (expires_at);
