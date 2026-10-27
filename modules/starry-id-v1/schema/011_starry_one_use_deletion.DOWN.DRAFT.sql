-- Disposable SQLite :memory: DOWN only, not an authorized production purge.
-- The legal retention/audit lifecycle of used challenges is NOT approved.
BEGIN IMMEDIATE;
DROP TRIGGER IF EXISTS trg_r13_atomic_delete_once;
DROP TRIGGER IF EXISTS trg_r13_delete_challenge_guard;
DROP TRIGGER IF EXISTS trg_r13_delete_challenge_no_rewind;
DROP INDEX IF EXISTS idx_r13_delete_pending_member;
DROP TABLE IF EXISTS starry_deletion_challenges;
COMMIT;
