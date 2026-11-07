-- Remote config values an Owner or Admin sets per App in Admin Lite; they are laid over the App's defaults.
-- The key min_version overrides the App's minimum version. Values are public (served by GET /v1/apps/{id}/config).
CREATE TABLE app_config_overrides (
  app_id TEXT NOT NULL,
  key TEXT NOT NULL CHECK (key GLOB '[a-z]*' AND length(key) <= 40),
  value TEXT NOT NULL CHECK (json_valid(value) AND length(value) <= 400),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (app_id, key)
);
