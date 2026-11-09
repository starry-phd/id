-- Which central integration-instruction version each App says it was last built to. Reported by the App's own
-- /admin page (owner only); the Owner sees it next to the newest version to know which Apps still need an upgrade.
CREATE TABLE app_handoff_reports (
  app_id TEXT PRIMARY KEY,
  integrated_version TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  reported_by TEXT NOT NULL
);
