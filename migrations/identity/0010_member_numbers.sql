-- Member number: "<calling code>-<7 random digits>", e.g. 886-0112342. Unique, never changes,
-- never reused after the member is deleted. Used for R2 folders and customer support.
-- Existing members get theirs from the maintenance job (assignMissingMemberNumbers), not from this migration,
-- so a random collision can never fail the deploy.
ALTER TABLE users ADD COLUMN member_no TEXT;
ALTER TABLE users ADD COLUMN registration_country TEXT;
CREATE UNIQUE INDEX idx_users_member_no ON users (member_no) WHERE member_no IS NOT NULL;

-- Numbers of deleted members: kept (no personal data) so a number is never issued twice.
CREATE TABLE retired_member_numbers (
  member_no TEXT PRIMARY KEY,
  retired_at INTEGER NOT NULL
);
