-- App managers: a member trusted with the remote config (and read-only views) of specific Apps only.
CREATE TABLE app_staff (
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);
CREATE INDEX idx_app_staff_app ON app_staff (app_id);
