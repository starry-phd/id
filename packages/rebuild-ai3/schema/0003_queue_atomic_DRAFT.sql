-- AI-3 REBUILD Round 3: SQLite :memory: design, NEVER migrate real D1.
-- Writer: AI-3 only. AI-2 committed Billing outbox is another domain.
CREATE TABLE ai3_r3_claim(
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key)=66 AND substr(idempotency_key,1,2)='b_'),
 event_id TEXT NOT NULL,
 payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
 PRIMARY KEY(brand_id,app_id,environment,idempotency_key),
 UNIQUE(brand_id,app_id,environment,event_id)
);
CREATE TABLE ai3_r3_append(
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 event_id TEXT NOT NULL,
 schema_version TEXT NOT NULL CHECK(schema_version='rebuild-ai3.0.1-candidate'),
 event_type TEXT NOT NULL CHECK(event_type='billing.store_state_observed'),
 actor_ref TEXT NOT NULL,
 resource_ref TEXT NOT NULL,
 PRIMARY KEY(brand_id,app_id,environment,event_id)
);
CREATE TABLE ai3_r3_quarantine(
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 event_ref TEXT NOT NULL,
 reason TEXT NOT NULL,
 PRIMARY KEY(brand_id,app_id,environment,event_ref,reason)
);
CREATE TRIGGER ai3_r3_no_update BEFORE UPDATE ON ai3_r3_append
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER ai3_r3_no_delete BEFORE DELETE ON ai3_r3_append
 BEGIN SELECT RAISE(ABORT,'RETENTION_POLICY_PENDING'); END;
-- Both claim + append MUST be in ONE atomic AI-3 D1 transaction.
-- ACK only AFTER commit; same-key retry compares original event_id + digest.
-- Wrong digest -> durable quarantine BEFORE ACK. If this fails, retry.
-- If retry exhausted, DLQ persistence first; this SQL has NO Queue adapter.
