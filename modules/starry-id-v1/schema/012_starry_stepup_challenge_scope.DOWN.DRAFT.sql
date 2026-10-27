-- R14 disposable SQLite-memory rollback ONLY. Never downgrade real Auth
-- deletion fencing: would re-enable legacy unscoped R13 challenges.
BEGIN IMMEDIATE;
DROP TRIGGER IF EXISTS trg_r14_consumption_requires_same_stepup;
DROP TRIGGER IF EXISTS trg_r14_issue_bind_scope;
DROP TRIGGER IF EXISTS trg_r14_issuance_current_stepup;
DROP TABLE IF EXISTS starry_deletion_challenge_scope;
COMMIT;
