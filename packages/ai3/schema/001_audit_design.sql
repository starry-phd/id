-- AI-3 D1/SQLite audit DESIGN ONLY. Not a deployed or authorized production migration.
-- Starry-only; owner: AI-3 audit service. Server must supply verified scope/actor.
-- No tokens, secrets, email, message bodies, or before/after member values.
CREATE TABLE IF NOT EXISTS ai3_audit_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  brand_id TEXT NOT NULL DEFAULT 'starry' CHECK (brand_id = 'starry'),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('development','staging','production')),
  occurred_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  result TEXT NOT NULL,
  idempotency_key TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','service','system','anonymous')),
  actor_id TEXT,
  permission TEXT NOT NULL,
  action TEXT NOT NULL,
  approval_ref TEXT,
  CHECK ((actor_kind='anonymous' AND actor_id IS NULL) OR (actor_kind!='anonymous' AND actor_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ai3_audit_scope_time
  ON ai3_audit_events(brand_id, app_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai3_audit_correlation
  ON ai3_audit_events(correlation_id);
-- Domain-owned atomic unique key for idempotent delivery. Never infer this from Queue semantics.
CREATE TABLE IF NOT EXISTS ai3_delivery_dedupe (
  brand_id TEXT NOT NULL CHECK (brand_id='starry'),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('development','staging','production')),
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','delivered','failed','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  PRIMARY KEY(brand_id,app_id,environment,event_type,idempotency_key)
);
-- Retention/purge require policy + separately audited controlled procedure; no generic UPDATE/DELETE to admin UI.

-- AI-2 alone writes transaction/entitlement/outbox; AI-3 alone writes redacted audit inbox.
-- Design only; atomic insert, append-only controls and retention require Gate approval.
CREATE TABLE IF NOT EXISTS ai3_billing_audit_inbox (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
 event_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('billing.purchase_verified','billing.renewed','billing.refund_recorded','billing.entitlement_changed')),
 provider_event_id TEXT NOT NULL,
 transaction_ref TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('ready','stale_audit_only')),
 PRIMARY KEY(brand_id,app_id,environment,provider_event_id),
 UNIQUE(brand_id,app_id,environment,event_id)
);
CREATE INDEX IF NOT EXISTS ai3_billing_scope_order ON ai3_billing_audit_inbox(brand_id,app_id,environment,transaction_ref,occurred_at DESC);
