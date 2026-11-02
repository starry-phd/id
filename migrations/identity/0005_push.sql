-- Push notifications (spec S-NTF-01, A-04): Expo push tokens and per-App category opt-outs.

CREATE TABLE push_tokens (
  token TEXT PRIMARY KEY CHECK (length(token) BETWEEN 10 AND 200),
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_push_tokens_user ON push_tokens (user_id, app_id);

-- Only explicit choices are stored; a category without a row is enabled.
CREATE TABLE push_preferences (
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id, category)
);
