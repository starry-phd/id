-- AI-3 REBUILD Phase 0 DESIGN ONLY. Do NOT apply to remote D1.
-- Sole logical audit/inbox writer AI-3. AI-1 owns member/session; AI-2 owns billing.
-- Real retention and physical D1 count require AI-0 Gate decision.
CREATE TABLE ai3_delivery_inbox (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 idempotency_key TEXT NOT NULL,
 event_id TEXT NOT NULL,
 event_type TEXT NOT NULL,
 canonical_digest TEXT NOT NULL,
 claim_state TEXT NOT NULL DEFAULT 'pending' CHECK(claim_state IN ('pending','processed','quarantined','dead_letter')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0 AND attempt_count<=5),
 PRIMARY KEY(brand_id,app_id,environment,idempotency_key),
 UNIQUE(brand_id,app_id,environment,event_id),
 CHECK(length(app_id)>0 AND length(idempotency_key)>0 AND length(canonical_digest)>0)
);
CREATE TABLE ai3_audit_metadata (
 event_id TEXT NOT NULL,brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 event_type TEXT NOT NULL,
 schema_version TEXT NOT NULL CHECK(schema_version='rebuild-ai3.0.1-candidate'),
 occurred_at TEXT NOT NULL,correlation_id TEXT NOT NULL,
 resource_ref TEXT NOT NULL,actor_ref TEXT NOT NULL,
 result TEXT NOT NULL CHECK(result IN ('recorded','denied','queued')),
 classification TEXT NOT NULL CHECK(classification='metadata_only'),
 PRIMARY KEY(brand_id,app_id,environment,event_id)
);
CREATE INDEX ai3_scope_time ON ai3_audit_metadata(brand_id,app_id,environment,occurred_at DESC);
CREATE INDEX ai3_correlation ON ai3_audit_metadata(brand_id,correlation_id);
CREATE TRIGGER ai3_immutable_update BEFORE UPDATE ON ai3_audit_metadata
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER ai3_immutable_delete BEFORE DELETE ON ai3_audit_metadata
 BEGIN SELECT RAISE(ABORT,'RETENTION_POLICY_PENDING'); END;
-- Real single transaction insert/claim, conflict quarantine, crash recovery, outbox,
-- replay controls and legally approved retention must be implemented and tested later.
