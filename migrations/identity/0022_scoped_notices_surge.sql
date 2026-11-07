-- Announcements for one App (or all) in a time window, and a per-App hourly surge guard (S-PLT-01).
CREATE TABLE scoped_notices (
  notice_id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_scoped_notices_window ON scoped_notices (ends_at, starts_at);

-- When an App makes more than hourly_limit Battery reservations in an hour it is paused automatically.
CREATE TABLE app_surge_limits (
  app_id TEXT PRIMARY KEY,
  hourly_limit INTEGER NOT NULL CHECK (hourly_limit BETWEEN 1 AND 10000000),
  last_triggered_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
