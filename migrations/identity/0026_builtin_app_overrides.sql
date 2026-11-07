-- Admin overrides for the built-in Apps of config/apps.json. The file stays the baseline (and the fallback when this
-- table cannot be read); a row holds only the fields the Owner changed, as JSON, validated against the App format.
CREATE TABLE builtin_app_overrides (
  app_id TEXT PRIMARY KEY,
  patch TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
