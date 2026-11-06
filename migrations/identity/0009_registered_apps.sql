-- Apps registered by the Owner in Admin Lite (/admin/apps/new), so a new App needs no code change.
-- config/apps.json stays the source for the Apps already shipped; it wins on an app_id clash.
-- definition is the same JSON shape as an entry of config/apps.json (no secrets), validated on every read and write.
CREATE TABLE registered_apps (
  app_id TEXT PRIMARY KEY CHECK (length(app_id) BETWEEN 2 AND 32),
  definition TEXT NOT NULL CHECK (length(definition) <= 8000),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
