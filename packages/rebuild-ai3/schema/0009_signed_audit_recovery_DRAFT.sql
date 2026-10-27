-- R12 AI-3 offline SQLite :memory: Draft only, NOT a real D1 migration.
-- Source events are metadata-only, not raw identity, email, OAuth, token or files.
-- This DB cannot be its own independently protected PITR witness.
PRAGMA foreign_keys=ON;
CREATE TABLE ai3_r12_audit_events (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 seq INTEGER NOT NULL CHECK(seq>=1),
 event_ref TEXT NOT NULL CHECK(length(event_ref)=66 AND substr(event_ref,1,2)='a_'),
 classification TEXT NOT NULL CHECK(classification IN ('ordinary','important_management')),
 event_code TEXT NOT NULL CHECK(event_code IN (
  'RECEIVED','REVIEWING','CLOSED','ADMIN_ACTION','ACCESS_DENIED','ACCOUNT_DELETED')),
 occurred_ms INTEGER NOT NULL CHECK(occurred_ms>=0),
 source_revision INTEGER NOT NULL CHECK(source_revision>=1),
 resource_ref TEXT NOT NULL CHECK(length(resource_ref)=36 AND substr(resource_ref,1,4)='ref_'),
 decision_code TEXT NOT NULL CHECK(length(decision_code) BETWEEN 3 AND 64),
 PRIMARY KEY(brand_id,environment,seq),
 UNIQUE(brand_id,environment,event_ref)
);
CREATE TRIGGER ai3_r12_audit_no_update BEFORE UPDATE ON ai3_r12_audit_events
 BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER ai3_r12_audit_no_delete BEFORE DELETE ON ai3_r12_audit_events
 BEGIN SELECT RAISE(ABORT,'AUDIT_LEGAL_RETENTION_GATE'); END;
-- D1-shaped model only; a true authority must commit event plus its monotone
-- signed external witness under a separately approved protocol.
