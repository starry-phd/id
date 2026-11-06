-- Which Apps a member has signed in to. Lets an App's backend look up (public) names and avatars of its own
-- members only, e.g. for leaderboards. Deleted with the member.
CREATE TABLE member_apps (
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id)
);
CREATE INDEX idx_member_apps_app ON member_apps (app_id);

INSERT OR IGNORE INTO member_apps (user_id, app_id, first_seen_at)
SELECT user_id, app_id, MIN(created_at) FROM sessions GROUP BY user_id, app_id;
