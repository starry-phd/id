-- AI-2 R11 Q116 | SANDBOX :memory: ONLY; never deploy to Cloudflare D1.
-- Retrospective mutation is blocked in this local ledger. A PITR rollback
-- can still remove the ENTIRE ledger and its triggers: external witness MUST
-- be signed, independently hosted, immutable and more recent than the restore.
CREATE TABLE billing_recovery_outbox_DRAFT (
 brand_id TEXT NOT NULL DEFAULT 'starry' CHECK(brand_id='starry'),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 seq INTEGER NOT NULL CHECK(seq>=1),
 event_ref TEXT NOT NULL CHECK(length(event_ref)=66 AND substr(event_ref,1,2)='r_'),
 app_id TEXT NOT NULL CHECK(length(app_id)>0),
 store TEXT NOT NULL CHECK(store IN ('apple','google')),
 store_app_id TEXT NOT NULL CHECK(length(store_app_id)>0),
 offer_id TEXT NOT NULL CHECK(lower(offer_id) NOT LIKE '%battery%'),
 kind TEXT NOT NULL CHECK(kind IN ('monthly','yearly','one_time')),
 event_state TEXT NOT NULL CHECK(event_state IN
 ('PAID','RENEWED','REFUNDED','CHARGEBACK','EXPIRED','GRACE_PERIOD','ON_HOLD','REVOKED')),
 source_version INTEGER NOT NULL CHECK(source_version>=1),
 store_effective_sec INTEGER NOT NULL CHECK(store_effective_sec>=0),
 committed_sec INTEGER NOT NULL CHECK(committed_sec>=0),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 PRIMARY KEY(brand_id,environment,seq),
 UNIQUE(brand_id,environment,event_ref)
);
CREATE TRIGGER billing_recovery_outbox_no_update_DRAFT
 BEFORE UPDATE ON billing_recovery_outbox_DRAFT
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_BILLING'); END;
CREATE TRIGGER billing_recovery_outbox_no_delete_DRAFT
 BEFORE DELETE ON billing_recovery_outbox_DRAFT
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_BILLING'); END;
-- This does NOT supply official Store auth, independent witness, P05 outbox
-- consumer, or automatic replay/restore.
