-- AI-1 R9 Q98/Q114/Q115 disposable SQLite :memory: DRAFT only.
-- Depends on 001_starry_identity and 007_starry_age_deletion_admin.
-- Role appointment, legal retention, and actual audit storage remain blocked.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS starry_privacy_review_grants(
 s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
 app_id TEXT NOT NULL CHECK(length(app_id)>0),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging','production')),
 permission TEXT NOT NULL CHECK(permission IN ('appeal:review_status','privacy:review_retention')),
 auth_version INTEGER NOT NULL CHECK(auth_version>=1),
 expires_at INTEGER NOT NULL CHECK(expires_at>=0),
 revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at>=0),
 PRIMARY KEY(s_user_id,app_id,environment,permission)
);
CREATE INDEX IF NOT EXISTS idx_starry_privacy_grant_active
 ON starry_privacy_review_grants(environment,app_id,permission,expires_at)
 WHERE revoked_at IS NULL;
COMMIT;
