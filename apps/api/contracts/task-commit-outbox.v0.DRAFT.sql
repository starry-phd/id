-- R14 DRAFT: apply ONLY to disposable isolated SQLite :memory: test DB.
-- NOT an approved Cloudflare D1 migration / production issuer.
CREATE TABLE ai4_task_record (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 task_ref TEXT NOT NULL PRIMARY KEY,
 member_ref TEXT NOT NULL,
 app_id TEXT NOT NULL,
 task_type TEXT NOT NULL,
 policy_version INTEGER NOT NULL CHECK(policy_version>0),
 rate_version INTEGER NOT NULL CHECK(rate_version>0),
 price INTEGER NOT NULL CHECK(price>0),
 request_state TEXT NOT NULL CHECK(request_state IN ('accepted','succeeded','failed')),
 proof_revision INTEGER NOT NULL CHECK(proof_revision>=1),
 completed_at INTEGER,
 CHECK ((request_state='accepted' AND completed_at IS NULL AND proof_revision=1)
   OR (request_state IN ('succeeded','failed') AND completed_at IS NOT NULL AND proof_revision=2))
);
CREATE TABLE ai4_task_outbox (
 event_ref TEXT NOT NULL PRIMARY KEY,
 task_ref TEXT NOT NULL UNIQUE REFERENCES ai4_task_record(task_ref),
 member_ref TEXT NOT NULL,
 proof_revision INTEGER NOT NULL CHECK(proof_revision=2),
 request_state TEXT NOT NULL CHECK(request_state IN ('succeeded','failed')),
 price INTEGER NOT NULL CHECK(price>0),
 policy_version INTEGER NOT NULL CHECK(policy_version>0),
 rate_version INTEGER NOT NULL CHECK(rate_version>0)
);
CREATE TRIGGER ai4_task_final_immutable_update BEFORE UPDATE ON ai4_task_record
WHEN OLD.request_state IN ('succeeded','failed')
BEGIN SELECT RAISE(ABORT,'FINAL_TASK_IMMUTABLE'); END;
CREATE TRIGGER ai4_task_final_immutable_delete BEFORE DELETE ON ai4_task_record
WHEN OLD.request_state IN ('succeeded','failed')
BEGIN SELECT RAISE(ABORT,'FINAL_TASK_IMMUTABLE'); END;
CREATE TRIGGER ai4_outbox_no_update BEFORE UPDATE ON ai4_task_outbox
BEGIN SELECT RAISE(ABORT,'TASK_OUTBOX_IMMUTABLE'); END;
CREATE TRIGGER ai4_outbox_no_delete BEFORE DELETE ON ai4_task_outbox
BEGIN SELECT RAISE(ABORT,'TASK_OUTBOX_IMMUTABLE'); END;
CREATE TRIGGER ai4_outbox_bind BEFORE INSERT ON ai4_task_outbox
WHEN NOT EXISTS (
 SELECT 1 FROM ai4_task_record t
 WHERE t.task_ref=NEW.task_ref AND t.brand_id='starry'
 AND t.member_ref=NEW.member_ref AND t.proof_revision=NEW.proof_revision
 AND t.request_state=NEW.request_state AND t.price=NEW.price
 AND t.policy_version=NEW.policy_version AND t.rate_version=NEW.rate_version
)
BEGIN SELECT RAISE(ABORT,'TASK_OUTBOX_SOURCE_MISMATCH'); END;
