-- Service keys for App backends created in Admin Lite (/admin/apps), so a new App needs no Worker Secret.
-- Only the SHA-256 of the key is stored; the key is shown once when it is created or rotated.
-- BATTERY_SERVICE_KEYS (Worker Secret) keeps working for the Apps that already use it.
CREATE TABLE battery_app_keys (
  app_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  rotated_at INTEGER,
  rotated_by TEXT
);
