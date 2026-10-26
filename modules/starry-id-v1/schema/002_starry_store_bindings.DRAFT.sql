-- AI-1 REBUILD round 2 - logical D1 / SQLite draft only; NEVER apply to production.
-- Starry ID owns server-assigned app/store account references, NOT transactions
-- nor Billing entitlement (AI-2 owns originalTransactionId uniqueness).
CREATE TABLE starry_store_bindings (
  s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  store_app_id TEXT NOT NULL,
  store_environment TEXT NOT NULL CHECK(store_environment IN ('sandbox','production')),
  account_binding TEXT NOT NULL,
  revoked_at INTEGER,
  expires_at INTEGER,
  PRIMARY KEY (s_user_id, app_id, environment, store_environment, store, store_app_id),
  UNIQUE (store, store_app_id, store_environment, account_binding),
  CHECK(length(account_binding)>0 AND length(account_binding)<=180)
);
CREATE INDEX idx_starry_store_binding_active
  ON starry_store_bindings(s_user_id,app_id,environment,store,store_app_id,store_environment,revoked_at);
-- No provider credentials, raw Apple tokens, Google RTDN or transaction ids.
-- Cross-entity source of truth: Starry member_id maps to server-created binding;
-- AI-2 purchase ownership of originalTransactionId is separate and immutable.
-- Revocation must prevent new auth while retention/purchase restore is handled
-- by approved policies and backend events (not unilateral row deletion).
