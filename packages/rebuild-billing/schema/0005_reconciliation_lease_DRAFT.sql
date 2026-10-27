-- AI-2 R8 Q113 OFFLINE DRAFT ONLY. NEVER apply to Cloudflare or production D1.
-- This is isolated SQLite :memory: lease/CAS gate rehearsal; no real Store calls.
-- Real Billing provider refs/raw tokens/identity MUST NOT be stored in this table.
CREATE TABLE billing_reconcile_job_DRAFT (
  job_ref TEXT PRIMARY KEY CHECK (length(job_ref)=66 AND substr(job_ref,1,2)='r_'),
  brand_id TEXT NOT NULL DEFAULT 'starry' CHECK(brand_id='starry'),
  app_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
  store_environment TEXT NOT NULL DEFAULT 'sandbox' CHECK(store_environment='sandbox'),
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  store_app_id TEXT NOT NULL,
  offer_id TEXT NOT NULL CHECK(lower(offer_id) NOT LIKE '%battery%'),
  kind TEXT NOT NULL CHECK(kind IN ('monthly','yearly','one_time')),
  source_version INTEGER NOT NULL CHECK(source_version>=1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0,1)),
  next_due_sec INTEGER NOT NULL CHECK(next_due_sec>=0),
  lease_token TEXT,
  lease_until_sec INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','review_only')),
  last_review_result TEXT CHECK(last_review_result IN ('candidate_observation','review_required')),
  last_review_digest TEXT,
  last_review_at_sec INTEGER,
  CHECK((lease_token IS NULL AND lease_until_sec IS NULL)
    OR (lease_token IS NOT NULL AND lease_until_sec IS NOT NULL))
);
CREATE INDEX billing_reconcile_due_DRAFT
  ON billing_reconcile_job_DRAFT(brand_id,app_id,environment,store,store_app_id,status,next_due_sec);
-- Claim: one transaction / one winner, never grant entitlement and never trust client nonce.
-- SELECT candidates in a bounded backend loop, then CAS with this per-row UPDATE.
-- UPDATE billing_reconcile_job_DRAFT
-- SET lease_token=:fresh_server_nonce,lease_until_sec=:now_sec+:lease_seconds,
--     attempts=attempts+1,status='leased'
-- WHERE job_ref=:ref AND brand_id='starry' AND app_id=:app_id
--   AND environment=:environment AND store_environment='sandbox'
--   AND store=:store AND store_app_id=:store_app_id
--   AND is_deleted=0 AND next_due_sec<=:now_sec
--   AND attempts<:max_attempts
--   AND (status='pending' OR (status='leased' AND lease_until_sec<=:now_sec))
-- RETURNING job_ref,lease_token,source_version,attempts;
-- Receipt: independent CAS with SAME lease token/source version and no deletion;
-- either review-only terminal (manual review) or reschedule the next requery.
-- UPDATE billing_reconcile_job_DRAFT SET
--   status=:next_status,next_due_sec=:future_sec,lease_token=NULL,lease_until_sec=NULL,
--   last_review_result=:safe_result,last_review_digest=:safe_digest,last_review_at_sec=:now_sec
-- WHERE job_ref=:ref AND lease_token=:lease_token AND source_version=:expected_version
--   AND is_deleted=0 AND lease_until_sec>:now_sec AND status='leased'
-- RETURNING job_ref;
-- A failure/missing receipt -> retry; never ACK a queue or update paid entitlement.
