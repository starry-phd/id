-- Disposable SQLite :memory: only; NOT an approved live privacy erasure.
BEGIN IMMEDIATE;
DROP INDEX IF EXISTS idx_starry_privacy_grant_active;
DROP TABLE IF EXISTS starry_privacy_review_grants;
COMMIT;
