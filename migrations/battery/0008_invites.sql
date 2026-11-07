-- Invite codes (owner decision 2026-11-07): a code gives a member extra FREE Quantum Battery in one App.
-- It is a gift, never a purchase; the units land in quantum_accounts like any other quantum balance and are
-- spendable only in that App. A member can redeem a given code once.
CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 6 AND 32),
  app_id TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 1000),
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100000),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= max_uses),
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  note TEXT CHECK (note IS NULL OR length(note) <= 100),
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invite_codes_app ON invite_codes (app_id, created_at);

CREATE TABLE invite_redemptions (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE INDEX idx_invite_redemptions_user ON invite_redemptions (user_id);
