-- AI-3 POC ONLY: DO NOT APPLY TO REAL D1. No live resource is provisioned.
-- AI-0 DATA-001 physical D1/DO decision & retention approval are pending.
CREATE TABLE ai3_r4_inbox (
 brand_id TEXT NOT NULL CHECK (brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK (environment IN ('development','staging')),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key)=66 AND substr(idempotency_key,1,2)='b_'),
 event_id TEXT NOT NULL,
 payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
 PRIMARY KEY(brand_id,app_id,environment,idempotency_key),
 UNIQUE(brand_id,app_id,environment,event_id)
);
CREATE TABLE ai3_r4_audit (
 brand_id TEXT NOT NULL CHECK (brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK (environment IN ('development','staging')),
 event_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 schema_version TEXT NOT NULL CHECK(schema_version='rebuild-ai3.0.1-candidate'),
 event_type TEXT NOT NULL CHECK(event_type='billing.store_state_observed'),
 occurred_at TEXT NOT NULL,
 actor_ref TEXT NOT NULL,
 resource_ref TEXT NOT NULL,
 classification TEXT NOT NULL CHECK(classification='metadata_only'),
 result TEXT NOT NULL CHECK(result='recorded'),
 PRIMARY KEY(brand_id,app_id,environment,event_id),
 FOREIGN KEY(brand_id,app_id,environment,idempotency_key)
 REFERENCES ai3_r4_inbox(brand_id,app_id,environment,idempotency_key)
);
CREATE TABLE ai3_r4_quarantine (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 idempotency_key TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN(
 'UNVERIFIED_OR_UNCOMMITTED_SOURCE','P05_SCOPE_VERSION_OR_FIELDS_DENIED',
 'AI0_P05_NOT_APPROVED','AUDIT_FIELDS_DENIED','IDEMPOTENCY_DIGEST_CONFLICT',
 'STALE_BILLING_EVENT')),
 PRIMARY KEY(brand_id,app_id,environment,idempotency_key,reason)
);
CREATE TRIGGER ai3_r4_audit_no_update BEFORE UPDATE ON ai3_r4_audit
 BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER ai3_r4_audit_no_delete BEFORE DELETE ON ai3_r4_audit
 BEGIN SELECT RAISE(ABORT,'RETENTION_PENDING'); END;
-- SQL compound D1 batch (ONE transaction):
-- 1) INSERT INTO inbox ON CONFLICT DO NOTHING
-- 2) INSERT audit SELECT ... WHERE EXISTS matching inbox key/event/digest
-- 3) read back both for durable proof; missing/partial => throw, no ACK.
-- No cross-D1 exactly-once claim. AI-4 worker queue adapter may ACK only on committed result.
