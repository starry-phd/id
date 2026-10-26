-- CI rollback ONLY: drop dependent policy tables, preserve member/session records.
BEGIN IMMEDIATE;
DROP INDEX IF EXISTS idx_starry_single_supreme;
DROP TABLE IF EXISTS starry_admin_roles;
DROP TABLE IF EXISTS starry_deletion_outbox;
COMMIT;
