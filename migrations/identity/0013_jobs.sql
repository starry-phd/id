-- Retry queue for the clean-up that follows a member deletion (avatar object, billing rows, Battery rows),
-- and one heartbeat row per scheduled job so Admin Lite can show whether the Cron Triggers keep succeeding.
-- Both hold only the random member ID, never personal data.
CREATE TABLE cleanup_jobs (
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'billing', 'battery')),
  user_id TEXT NOT NULL,
  payload TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  abandoned_at INTEGER
);
CREATE INDEX idx_cleanup_jobs_due ON cleanup_jobs (abandoned_at, next_attempt_at);

CREATE TABLE job_heartbeats (
  job TEXT PRIMARY KEY,
  last_started_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT
);
