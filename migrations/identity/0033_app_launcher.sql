-- What the Owner chose for the 9-dot App launcher: order, icon, name, store links and a one-line description per App.
-- A row exists only for Apps the Owner edited or moved; every field left NULL falls back to the App registry.
CREATE TABLE app_launcher (
  app_id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  icon_key TEXT,
  web_url TEXT,
  play_url TEXT,
  appstore_url TEXT,
  summary TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
