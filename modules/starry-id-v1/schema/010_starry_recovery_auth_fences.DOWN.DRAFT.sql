-- DISPOSABLE SQLite :memory: ONLY.
-- Never drop live recovery witnesses/counters without legal & security Gate.
BEGIN IMMEDIATE;
DROP TRIGGER IF EXISTS trg_starry_r10_no_delete;
DROP TRIGGER IF EXISTS trg_starry_r10_no_rewind;
DROP TRIGGER IF EXISTS trg_starry_r10_gift_fence;
DROP TRIGGER IF EXISTS trg_starry_r10_session_fence;
DROP TRIGGER IF EXISTS trg_starry_r10_deleted_fence;
DROP TABLE IF EXISTS starry_auth_recovery_fence;
COMMIT;
