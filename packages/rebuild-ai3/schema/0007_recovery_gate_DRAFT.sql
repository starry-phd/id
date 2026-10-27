-- Q116 OFFLINE SQLITE :memory: ONLY. Not intended as a live D1 migration.
-- This table is for immutable review evidence only: no backup bytes, secrets,
-- credential hashes, OAuth subjects, personal data, or restore instructions.
PRAGMA foreign_keys=ON;
CREATE TABLE ai3_restore_review (
 request_ref TEXT PRIMARY KEY,
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 environment TEXT NOT NULL CHECK(environment='isolated-test'),
 dataset TEXT NOT NULL CHECK(dataset IN ('battery','audit','appeals')),
 pitr_ref TEXT NOT NULL,
 independent_ref TEXT NOT NULL CHECK(independent_ref<>pitr_ref),
 review_status TEXT NOT NULL CHECK(review_status='review_only'),
 created_ms INTEGER NOT NULL CHECK(created_ms>=0)
);
CREATE TABLE ai3_restore_fence (
 request_ref TEXT NOT NULL REFERENCES ai3_restore_review(request_ref),
 fence_name TEXT NOT NULL CHECK(fence_name IN (
 'deleted_members','revoked_sessions','claimed_registration_gifts',
 'battery_journal','committed_ai_tasks','billing_outbox','audit_events')),
 version INTEGER NOT NULL CHECK(version>=0),
 PRIMARY KEY(request_ref,fence_name)
);
CREATE TRIGGER ai3_restore_review_no_update BEFORE UPDATE ON ai3_restore_review
 BEGIN SELECT RAISE(ABORT,'RECOVERY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER ai3_restore_review_no_delete BEFORE DELETE ON ai3_restore_review
 BEGIN SELECT RAISE(ABORT,'RECOVERY_REVIEW_RETENTION_GATE'); END;
CREATE TRIGGER ai3_restore_fence_no_update BEFORE UPDATE ON ai3_restore_fence
 BEGIN SELECT RAISE(ABORT,'RECOVERY_FENCE_IMMUTABLE'); END;
CREATE TRIGGER ai3_restore_fence_no_delete BEFORE DELETE ON ai3_restore_fence
 BEGIN SELECT RAISE(ABORT,'RECOVERY_FENCE_RETENTION_GATE'); END;
