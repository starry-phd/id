-- AI-1 Round 3 OAuth one-time state, Starry ID logical D1 owner ONLY.
-- DRAFT / SQLite-memory tests; DO NOT RUN on live D1 without AI-0 migration Gate.
-- codeVerifier is NEVER stored here or returned to browser. AI-4 must store the
-- verifier encrypted/backend-only in ephemeral secret store keyed by state.
CREATE TABLE starry_oauth_attempts (
 state TEXT PRIMARY KEY CHECK(length(state)>=32 AND length(state)<=256),
 provider TEXT NOT NULL CHECK(provider IN ('apple','google')),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 client_id TEXT NOT NULL,
 code_challenge TEXT NOT NULL,
 nonce TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 created_at INTEGER NOT NULL,
 CHECK(expires_at>created_at)
);
CREATE INDEX idx_starry_oauth_expires ON starry_oauth_attempts(expires_at);
-- One-winner atomic state claim:
-- UPDATE starry_oauth_attempts SET consumed_at=? WHERE state=? AND provider=?
-- AND consumed_at IS NULL AND expires_at>?;
-- MUST require changed rows = 1 before code exchange. No raw OAuth tokens or
-- Apple/Google provider email stored in this table.
