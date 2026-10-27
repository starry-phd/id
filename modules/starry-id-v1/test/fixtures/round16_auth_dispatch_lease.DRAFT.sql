-- AI-1 R16 TEST FIXTURE ONLY. NOT A DEPLOYABLE MIGRATION.
-- Kept outside schema/ deliberately: AI-0 immutable 38-SQL inventory Gate
-- must remain unchanged until official migration review/approval.
-- Apply only in disposable SQLite :memory: tests after Auth 001/007/011/012/013.
CREATE TABLE starry_auth_deletion_dispatch_claims(
 event_id TEXT PRIMARY KEY REFERENCES starry_deletion_outbox(event_id),
 publisher_id TEXT NOT NULL CHECK(publisher_id='starry-auth-sole-v1'),
 lease_token TEXT NOT NULL UNIQUE
  CHECK(length(lease_token)=64 AND lease_token NOT GLOB '*[^0-9a-f]*'),
 lease_expires_at INTEGER NOT NULL CHECK(lease_expires_at>=0),
 attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 1000)
);
CREATE TRIGGER r16_no_delete_claim
 BEFORE DELETE ON starry_auth_deletion_dispatch_claims
 BEGIN SELECT RAISE(ABORT,'R16_DISPATCH_CLAIM_IMMUTABLE'); END;
CREATE TRIGGER r16_claim_owner_token
 BEFORE UPDATE ON starry_auth_deletion_dispatch_claims
 WHEN NEW.publisher_id<>OLD.publisher_id OR NEW.event_id<>OLD.event_id OR
      NEW.attempt_no<>OLD.attempt_no+1 OR
      NEW.lease_expires_at<=OLD.lease_expires_at OR
      NEW.lease_token=OLD.lease_token
 BEGIN SELECT RAISE(ABORT,'R16_DISPATCH_FENCE_DENIED'); END;
