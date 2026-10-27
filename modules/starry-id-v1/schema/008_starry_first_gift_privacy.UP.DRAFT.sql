-- AI-1 R8 Q119: DISPOSABLE SQLite :memory: DRAFT ONLY.
-- A deterministic keyed pseudonym remains personal data: no real D1 migration
-- until a documented Privacy Gate approves legal basis, purpose, retention,
-- access, right-of-erasure exceptions, breach protection and key rotation.
-- Absolutely no raw provider subject/email/token or deleted s_user_id here.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS starry_first_gift_claims(
 fingerprint TEXT PRIMARY KEY NOT NULL
  CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
 claim_version INTEGER NOT NULL CHECK(claim_version>=1),
 claimed_at INTEGER NOT NULL CHECK(claimed_at>=0)
);
COMMIT;
