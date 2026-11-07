-- Redeem codes (owner decision 2026-11-07): one generator for every App. A code is either
--   kind 'quantum': free Quantum Battery in ONE App (app_id required), spendable only there, or
--   kind 'battery': free Starry Battery for the current month, shared by all Apps (app_id null).
-- Codes are gifts, never sold. batch_id groups the codes made by one run of the generator.
CREATE TABLE invite_codes_new (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 6 AND 32),
  kind TEXT NOT NULL DEFAULT 'quantum' CHECK (kind IN ('quantum', 'battery')),
  app_id TEXT,
  units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 1000),
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100000),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= max_uses),
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  note TEXT CHECK (note IS NULL OR length(note) <= 100),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  batch_id TEXT,
  CHECK ((kind = 'quantum' AND app_id IS NOT NULL) OR (kind = 'battery' AND app_id IS NULL))
);
INSERT INTO invite_codes_new (code, kind, app_id, units, max_uses, used, expires_at, active, note, created_by, created_at)
  SELECT code, 'quantum', app_id, units, max_uses, used, expires_at, active, note, created_by, created_at FROM invite_codes;
DROP TABLE invite_codes;
ALTER TABLE invite_codes_new RENAME TO invite_codes;
CREATE INDEX idx_invite_codes_app ON invite_codes (app_id, created_at);
CREATE INDEX idx_invite_codes_batch ON invite_codes (batch_id, created_at);
