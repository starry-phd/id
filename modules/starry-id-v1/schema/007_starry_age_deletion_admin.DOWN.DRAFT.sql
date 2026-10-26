-- CI rollback ONLY: drop dependent policy tables, preserve member/session records.
BEGIN IMMEDIATE;
DROP TRIGGER IF EXISTS trg_starry_r7_no_deleted_revival;
DROP INDEX IF EXISTS idx_starry_single_supreme;
DROP TABLE IF EXISTS starry_admin_roles;
DROP TABLE IF EXISTS starry_deletion_outbox;
COMMIT;
