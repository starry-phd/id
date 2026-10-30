-- AI-1 M2 local-only durable deletion request RECEIPT; DRAFT, NOT a live migration.
-- Apply in ONE physically isolated Starry DEV/STAGING D1 authority after 001.
-- This is NOT erasure, logout, suspension, account deletion or legal retention.
-- Q104/Q119, PITR, audit-FK disposition and actual erasure remain HOLD.
CREATE TABLE IF NOT EXISTS starry_m2_deletion_requests (
  request_id TEXT PRIMARY KEY
    CHECK(length(request_id)=54 AND substr(request_id,1,6)='m2del-'),
  s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
  app_id TEXT NOT NULL CHECK(app_id='starry-id'),
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  status TEXT NOT NULL CHECK(status IN
    ('awaiting_second_confirmation','pending_processing')),
  first_confirmed_at INTEGER NOT NULL CHECK(first_confirmed_at>=0),
  second_confirmed_at INTEGER CHECK(
    second_confirmed_at IS NULL OR second_confirmed_at>=first_confirmed_at),
  CHECK(
    (status='awaiting_second_confirmation' AND second_confirmed_at IS NULL)
    OR (status='pending_processing' AND second_confirmed_at IS NOT NULL)
  ),
  UNIQUE(s_user_id,app_id,environment)
);
CREATE INDEX IF NOT EXISTS idx_starry_m2_deletion_request_status
  ON starry_m2_deletion_requests(status,first_confirmed_at);

-- Event rows are the minimum same-source receipt, not an outbound Queue ACK.
-- Opaque request id is pseudonymous and may still be regulated personal data;
-- audit/ledger retention and deletion require a separate per-category decision.
CREATE TABLE IF NOT EXISTS starry_m2_deletion_request_audit (
  event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES starry_m2_deletion_requests(request_id),
  event_type TEXT NOT NULL CHECK(event_type IN
    ('first_confirmation_received','second_confirmation_received')),
  app_id TEXT NOT NULL CHECK(app_id='starry-id'),
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  UNIQUE(request_id,event_type)
);
CREATE TRIGGER IF NOT EXISTS starry_m2_delete_request_first_audit
AFTER INSERT ON starry_m2_deletion_requests
WHEN NEW.status='awaiting_second_confirmation'
BEGIN
  INSERT INTO starry_m2_deletion_request_audit
    (event_id,request_id,event_type,app_id,environment,created_at)
  VALUES(
    NEW.request_id||':first',NEW.request_id,'first_confirmation_received',
    NEW.app_id,NEW.environment,NEW.first_confirmed_at
  );
END;
CREATE TRIGGER IF NOT EXISTS starry_m2_delete_request_second_audit
AFTER UPDATE OF status ON starry_m2_deletion_requests
WHEN OLD.status='awaiting_second_confirmation'
  AND NEW.status='pending_processing'
BEGIN
  INSERT INTO starry_m2_deletion_request_audit
    (event_id,request_id,event_type,app_id,environment,created_at)
  VALUES(
    NEW.request_id||':second',NEW.request_id,'second_confirmation_received',
    NEW.app_id,NEW.environment,NEW.second_confirmed_at
  );
END;

-- Intentionally no 'completed' status or automated state transition.
-- Do not add CASCADE, change foreign_keys, guess retention, or claim PITR-safe
-- physical completion. This adds another inbound FK to the members table:
-- AI-3 #288 preflight and Q104/Q119 must inspect this before any erasure.
