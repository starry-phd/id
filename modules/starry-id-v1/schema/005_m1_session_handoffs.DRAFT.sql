-- AI-0/AI-1 M1 one-time mobile Session handoff. DRAFT, NOT a remote migration.
-- Store only SHA-256(code), never the opaque code or the signed Session bearer.
-- The 60-second handoff is single-use and tied to the exact original D1 Session,
-- provider subject, Starry app and staging environment. No refresh token is issued.
-- Apply only in a separately approved, physically isolated Starry staging D1
-- after 001–004 and before any route is enabled. Never use Echo/legacy D1.
CREATE TABLE IF NOT EXISTS starry_m1_session_handoffs (
  handoff_hash TEXT PRIMARY KEY
    CHECK(length(handoff_hash)=64 AND handoff_hash NOT GLOB '*[^0-9a-f]*'),
  -- Deliberately no FK to mutable Session/identity rows: unlink or account
  -- erasure must never be blocked by an outstanding short-lived handoff.
  -- Redemption re-joins both authorities and fails closed if either vanished.
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('apple','google')),
  provider_subject TEXT NOT NULL
    CHECK(length(provider_subject)>=1 AND length(provider_subject)<=180),
  app_id TEXT NOT NULL CHECK(app_id='starry-id'),
  environment TEXT NOT NULL CHECK(environment='staging'),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  consumed_at INTEGER CHECK(consumed_at IS NULL OR consumed_at>=created_at)
);
CREATE INDEX IF NOT EXISTS idx_starry_m1_session_handoffs_expiry
  ON starry_m1_session_handoffs(expires_at);
