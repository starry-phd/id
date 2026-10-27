-- Q114 OFFLINE DRAFT, no actual Cloudflare migration. Credential originals
-- MUST NEVER be stored. Legal retention / erasure authorization unresolved.
PRAGMA foreign_keys=ON;
CREATE TABLE ai3_appeal_case (
 case_ref TEXT PRIMARY KEY CHECK(length(case_ref)=69 AND substr(case_ref,1,5)='case_'),
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 app_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 client_key TEXT NOT NULL CHECK(length(client_key)=66 AND substr(client_key,1,2)='a_'),
 topic_code TEXT NOT NULL CHECK(length(topic_code) BETWEEN 3 AND 40),
 credential_digest TEXT NOT NULL CHECK(length(credential_digest)=64),
 created_ms INTEGER NOT NULL CHECK(created_ms>=0),
 updated_ms INTEGER NOT NULL CHECK(updated_ms>=created_ms),
 status TEXT NOT NULL CHECK(status IN ('received','reviewing','closed')),
 UNIQUE(brand_id,app_id,environment,client_key)
);
CREATE TABLE ai3_appeal_attachment_hash (
 case_ref TEXT NOT NULL REFERENCES ai3_appeal_case(case_ref),
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 scan_passed INTEGER NOT NULL CHECK(scan_passed=1),
 PRIMARY KEY(case_ref,ordinal)
);
CREATE TABLE ai3_appeal_event (
 case_ref TEXT NOT NULL REFERENCES ai3_appeal_case(case_ref),
 revision INTEGER NOT NULL CHECK(revision>=1),
 event_code TEXT NOT NULL CHECK(event_code IN ('RECEIVED','REVIEWING','CLOSED')),
 at_ms INTEGER NOT NULL CHECK(at_ms>=0),
 PRIMARY KEY(case_ref,revision)
);
CREATE TRIGGER ai3_appeal_event_immutable_update BEFORE UPDATE ON ai3_appeal_event
 BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER ai3_appeal_event_immutable_delete BEFORE DELETE ON ai3_appeal_event
 BEGIN SELECT RAISE(ABORT,'LEGAL_RETENTION_GATE'); END;
-- Trusted server issues 256bit secret; stores ONLY SHA256/HMAC digest.
-- Real storage must atomically bind client_key+case_ref+hashes+RECEIVED event.
-- Raw attachment uploaded solely to isolated non-public scanner with malware
-- validation, file headers, bounded total size, retention and cleanup Gate.
-- No live anonymous API/bucket, real email or notification.
