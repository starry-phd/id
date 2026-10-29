-- M1 LOCAL-ONLY OAuth attempt store. NOT an approved production migration.
-- Place only in same SQLite authority as starry_members/identities/sessions.
-- Secret code_verifier needs encryption-at-rest/TTL cleanup before remote enable.
CREATE TABLE IF NOT EXISTS starry_m1_oauth_attempts(
 state TEXT PRIMARY KEY,
 provider TEXT NOT NULL CHECK(provider IN ('apple','google')),
 client_id TEXT NOT NULL,
 code_verifier TEXT NOT NULL,
 code_challenge TEXT NOT NULL,
 nonce TEXT NOT NULL,
 app_id TEXT NOT NULL CHECK(app_id='starry-id'),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 CHECK(length(state)>=32 AND length(state)<=256),
 CHECK(length(nonce)>=16 AND length(nonce)<=256),
 CHECK(length(code_verifier)>=43 AND length(code_verifier)<=128),
 CHECK(length(code_challenge)=43),
 CHECK(consumed_at IS NULL OR consumed_at>=0)
);
CREATE INDEX IF NOT EXISTS idx_starry_m1_oauth_attempts_expiry ON starry_m1_oauth_attempts(expires_at);
