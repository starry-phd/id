-- Account lifecycle (spec S-ID-06 deletion with 7-day grace, S-ID-07 suspension).

-- Why the member is suspended (admin note, max 200 chars) and when the status last changed.
ALTER TABLE users ADD COLUMN status_reason TEXT CHECK (status_reason IS NULL OR length(status_reason) <= 200);
ALTER TABLE users ADD COLUMN status_changed_at INTEGER;
CREATE INDEX idx_users_deletion_due ON users (status, deletion_requested_at);

-- Apple refresh tokens, AES-GCM encrypted, kept only so they can be revoked
-- when the account is deleted (Apple requires revoking Sign in with Apple tokens).
CREATE TABLE apple_tokens (
  subject TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  refresh_token_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subject, client_id)
);
CREATE INDEX idx_apple_tokens_user ON apple_tokens (user_id);

-- Revocations still owed to Apple after the member's data is gone. No user link on purpose.
CREATE TABLE apple_revocations (
  revocation_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_apple_revocations_due ON apple_revocations (next_attempt_at);
