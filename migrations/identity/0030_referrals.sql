-- Referral tree: each member can have at most one referrer, set once and never changed.
-- A deleted referrer leaves the row (the member stays bound) with the referrer cleared.
CREATE TABLE referrals (
  invitee_user_id TEXT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  referrer_user_id TEXT REFERENCES users (user_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  CHECK (referrer_user_id IS NULL OR invitee_user_id <> referrer_user_id)
);
CREATE INDEX idx_referrals_referrer ON referrals (referrer_user_id);
