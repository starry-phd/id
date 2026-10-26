-- DESIGN ONLY: Starry BILL-001 Sandbox. NEVER apply to live D1.
-- This single logical Billing write-owner transaction boundary must include owner
-- first claim, verified event, entitlement CAS and outbox insertion.
-- Physical D1 layout is NOT fixed; requires AI-0 DATA-001 architecture Gate.
PRAGMA foreign_keys=ON;
CREATE TABLE billing_owner (
  owner_key TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL DEFAULT 'starry' CHECK (brand_id='starry'),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  store_app_id TEXT NOT NULL,
  original_transaction_id TEXT NOT NULL,
  s_user_id TEXT NOT NULL,
  binding_digest TEXT NOT NULL CHECK(length(binding_digest)=64),
  created_at TEXT NOT NULL,
  UNIQUE(store_environment,store,store_app_id,original_transaction_id)
);
CREATE TABLE billing_event (
  idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key)=66),
  owner_key TEXT NOT NULL REFERENCES billing_owner(owner_key),
  provider_event_ref TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  transaction_ref TEXT NOT NULL,
  sku TEXT NOT NULL CHECK(lower(sku) NOT LIKE '%battery%'),
  state TEXT NOT NULL CHECK(state IN
    ('PAID','RENEWED','REFUNDED','CHARGEBACK','EXPIRED','GRACE_PERIOD','ON_HOLD','REVOKED')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner_key,provider_event_ref)
);
CREATE TABLE billing_entitlement (
  owner_key TEXT NOT NULL REFERENCES billing_owner(owner_key),
  entitlement_key TEXT NOT NULL CHECK(lower(entitlement_key) NOT LIKE '%battery%'),
  s_user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','inactive')),
  period_started_at TEXT NOT NULL,
  last_effective_at TEXT NOT NULL,
  last_transaction_ref TEXT NOT NULL,
  valid_until TEXT,
  version INTEGER NOT NULL CHECK(version>=1),
  PRIMARY KEY(owner_key,entitlement_key)
);
CREATE TABLE billing_outbox (
  idempotency_key TEXT PRIMARY KEY REFERENCES billing_event(idempotency_key),
  event_type TEXT NOT NULL CHECK(event_type='billing.store_state_observed'),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  safe_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  created_at TEXT NOT NULL
);
CREATE TABLE billing_quarantine (
  quarantine_ref TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('CONFLICT','ACCOUNT_MISMATCH','PROVIDER_UNVERIFIED')),
  first_seen_at TEXT NOT NULL
);
-- Example adapter transaction design (NOT live implementation):
-- BEGIN IMMEDIATE;
-- INSERT owner with uniqueness; SELECT owner and reject different user/binding;
-- INSERT billing_event; if conflict compare payload digest (no overwrite);
-- UPDATE billing_entitlement with version CAS; require affected=1 if existing;
-- INSERT billing_outbox with same idempotency_key;
-- COMMIT; if ANY step fails, ROLLBACK without side effects.
-- Event/network delivery must occur AFTER COMMIT, via AI-3's audited adapter.
-- Do not call store provider during a DB transaction or publish outbox pre-commit.
