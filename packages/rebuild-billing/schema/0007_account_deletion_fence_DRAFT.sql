-- AI-2 R14 Q88 | OFFLINE ONLY, never apply to real Cloudflare D1.
-- Candidate access is NOT a paid entitlement; no raw user ID/Store token.
PRAGMA foreign_keys=ON;
CREATE TABLE billing_entitlement_candidate_DRAFT(
 candidate_ref TEXT PRIMARY KEY,
 brand_id TEXT NOT NULL DEFAULT 'starry' CHECK(brand_id='starry'),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 member_ref TEXT NOT NULL CHECK(length(member_ref)=66
 AND substr(member_ref,1,2)='m_' AND substr(member_ref,3) NOT GLOB '*[^0-9a-f]*'),
 offer_id TEXT NOT NULL CHECK(lower(offer_id) NOT LIKE '%battery%'),
 candidate_state TEXT NOT NULL CHECK(candidate_state IN ('candidate_active','revoked'))
);
CREATE TABLE billing_deletion_fence_DRAFT(
 brand_id TEXT NOT NULL DEFAULT 'starry' CHECK(brand_id='starry'),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 member_ref TEXT PRIMARY KEY CHECK(length(member_ref)=66
 AND substr(member_ref,1,2)='m_' AND substr(member_ref,3) NOT GLOB '*[^0-9a-f]*'),
 deleted_version INTEGER NOT NULL CHECK(deleted_version>=1),
 deleted_at_sec INTEGER NOT NULL CHECK(deleted_at_sec>0),
 event_ref TEXT NOT NULL UNIQUE CHECK(length(event_ref)=66
 AND substr(event_ref,1,2)='r_' AND substr(event_ref,3) NOT GLOB '*[^0-9a-f]*'),
 event_digest TEXT NOT NULL CHECK(length(event_digest)=64
 AND event_digest NOT GLOB '*[^0-9a-f]*')
);
-- Same Billing database: one INSERT/UPSERT with these UPDATEs is atomic.
CREATE TRIGGER billing_delete_revoke_insert_DRAFT
 AFTER INSERT ON billing_deletion_fence_DRAFT BEGIN
 UPDATE billing_entitlement_candidate_DRAFT SET candidate_state='revoked'
 WHERE member_ref=NEW.member_ref AND environment=NEW.environment
 AND brand_id='starry' AND candidate_state='candidate_active';
END;
CREATE TRIGGER billing_delete_revoke_update_DRAFT
 AFTER UPDATE ON billing_deletion_fence_DRAFT BEGIN
 UPDATE billing_entitlement_candidate_DRAFT SET candidate_state='revoked'
 WHERE member_ref=NEW.member_ref AND environment=NEW.environment
 AND brand_id='starry' AND candidate_state='candidate_active';
END;
-- Late Store requery must not reinsert/regrant a deleted member candidate.
CREATE TRIGGER billing_delete_no_late_insert_DRAFT
 BEFORE INSERT ON billing_entitlement_candidate_DRAFT
 WHEN EXISTS(SELECT 1 FROM billing_deletion_fence_DRAFT f WHERE
 f.member_ref=NEW.member_ref AND f.environment=NEW.environment AND f.brand_id='starry')
 BEGIN SELECT RAISE(ABORT,'DELETED_MEMBER_NO_NEW_BILLING'); END;
CREATE TRIGGER billing_delete_no_late_regrant_DRAFT
 BEFORE UPDATE OF candidate_state ON billing_entitlement_candidate_DRAFT
 WHEN NEW.candidate_state='candidate_active' AND EXISTS(
 SELECT 1 FROM billing_deletion_fence_DRAFT f WHERE
 f.member_ref=NEW.member_ref AND f.environment=NEW.environment AND f.brand_id='starry')
 BEGIN SELECT RAISE(ABORT,'DELETED_MEMBER_NO_REGRANT'); END;
-- PITR rolls tombstone and triggers back together. True independent signed
-- witness/Store authority/Privacy lawful retention and cross-D1 remain BLOCKED.
