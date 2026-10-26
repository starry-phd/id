
-- AI-3 sole logical owner. Design-only, never execute on real D1.
-- The AI-2 provider-verified billing_event + billing_outbox remain AI-2-only.
-- D1 transaction must atomically claim the inbox and append audit before ACK.
CREATE TABLE ai3_billing_audit_claim (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 store_environment TEXT NOT NULL CHECK(store_environment='sandbox'),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key)=66 AND substr(idempotency_key,1,2)='b_'),
 audit_event_ref TEXT NOT NULL,
 resource_ref TEXT NOT NULL,
 payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
 source_occurred_at TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('ready','stale_audit_only')),
 PRIMARY KEY(brand_id,app_id,environment,idempotency_key),
 UNIQUE(brand_id,app_id,environment,audit_event_ref)
);
CREATE INDEX ai3_billing_transaction_latest
 ON ai3_billing_audit_claim(brand_id,app_id,environment,resource_ref,source_occurred_at DESC);
-- Never store JSON/raw receipt, store auth token, email, individual accountBinding or SKU.
-- Equal key+digest => duplicate; key+different digest or event_ref => quarantine.
-- Actor-only replay requires AI-1/AI-0 Gate; consumers cannot mutate Billing state.
