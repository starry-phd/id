-- Owner-managed notices: an announcement banner and a maintenance switch (keys: announcement, maintenance, maintenance_message).
CREATE TABLE system_notices (
  key TEXT PRIMARY KEY CHECK (key IN ('announcement', 'maintenance', 'maintenance_message')),
  value TEXT NOT NULL CHECK (length(value) <= 500),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
