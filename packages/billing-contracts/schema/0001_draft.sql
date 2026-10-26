-- DESIGN ONLY / UNAPPLIED. Starry Billing SANDBOX D1 proposal, NEVER Production. Runtime environment and store_environment are separate.
CREATE TABLE billing_products (
  product_key TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL DEFAULT 'starry' CHECK(brand_id='starry'),
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  app_id TEXT NOT NULL, store TEXT NOT NULL CHECK(store IN ('apple','google')),
  store_app_id TEXT NOT NULL, sku TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('subscription','non_consumable')),
  entitlement_key TEXT NOT NULL, catalog_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  UNIQUE(environment,store_environment,app_id,store,store_app_id,sku)
);
CREATE TABLE billing_transactions (
  transaction_ref TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL DEFAULT 'starry' CHECK(brand_id='starry'),
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  app_id TEXT NOT NULL, store TEXT NOT NULL CHECK(store IN ('apple','google')),
  store_app_id TEXT NOT NULL, store_transaction_id TEXT NOT NULL,
  original_transaction_id TEXT NOT NULL,
  product_key TEXT NOT NULL REFERENCES billing_products(product_key),
  s_user_id TEXT NOT NULL, binding_digest TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  UNIQUE(store,store_environment,store_app_id,store_transaction_id)
);
CREATE INDEX idx_billing_original_owner
  ON billing_transactions(store,store_environment,store_app_id,original_transaction_id);
CREATE TABLE billing_events (
  event_ref TEXT PRIMARY KEY,
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  provider_event_id TEXT NOT NULL, payload_digest TEXT NOT NULL,
  transaction_ref TEXT NOT NULL REFERENCES billing_transactions(transaction_ref),
  lifecycle TEXT NOT NULL, occurred_at TEXT NOT NULL,
  processed_at TEXT NOT NULL, correlation_id TEXT NOT NULL,
  UNIQUE(store,store_environment,provider_event_id)
);
CREATE TABLE billing_entitlements (
  entitlement_ref TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  app_id TEXT NOT NULL, s_user_id TEXT NOT NULL, entitlement_key TEXT NOT NULL,
  source_transaction_ref TEXT NOT NULL REFERENCES billing_transactions(transaction_ref),
  state TEXT NOT NULL CHECK(state IN ('active','inactive')),
  valid_until TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  changed_at TEXT NOT NULL,
  UNIQUE(app_id,s_user_id,entitlement_key,source_transaction_ref)
);
CREATE INDEX idx_billing_entitlement_lookup
  ON billing_entitlements(app_id,s_user_id,state);
CREATE TABLE billing_refund_reviews (
  review_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  transaction_ref TEXT NOT NULL REFERENCES billing_transactions(transaction_ref),
  reviewer_id TEXT NOT NULL, scope_ref TEXT NOT NULL,
  approval_id TEXT NOT NULL, reason TEXT NOT NULL,
  step_up_verified_at TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(transaction_ref,approval_id)
);
CREATE TABLE billing_audit (
  audit_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
  event_ref TEXT, actor_ref TEXT,
  action TEXT NOT NULL, resource_ref TEXT NOT NULL,
  result TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL
);
-- MUST add atomic outbox, CAS, conflicts quarantine, official receipt verifier,
-- and approved retention before ANY sandbox integration.

-- NOTE: store_environment is the Apple/Google sandbox axis; 'environment' is Worker runtime.
-- In-memory schema test only after Gate; never apply this design SQL to real D1.
