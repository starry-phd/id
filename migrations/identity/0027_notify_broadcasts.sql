-- Staff broadcasts to every device of one App (ADR 0009: notification fan-out through a queue). A broadcast is split
-- into chunks of at most 50 members; each chunk is one queue message. The counters are filled in as chunks finish.
-- notify_broadcast_chunks makes a redelivered queue message harmless: a chunk that is already recorded is skipped.
CREATE TABLE notify_broadcasts (
  broadcast_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  chunks_total INTEGER NOT NULL,
  chunks_done INTEGER NOT NULL DEFAULT 0,
  members_total INTEGER NOT NULL,
  reached INTEGER NOT NULL DEFAULT 0,
  devices INTEGER NOT NULL DEFAULT 0,
  opted_out INTEGER NOT NULL DEFAULT 0,
  no_devices INTEGER NOT NULL DEFAULT 0,
  inactive INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER
);
CREATE INDEX notify_broadcasts_created ON notify_broadcasts (created_at DESC);
CREATE TABLE notify_broadcast_chunks (
  broadcast_id TEXT NOT NULL,
  chunk_no INTEGER NOT NULL,
  done_at INTEGER NOT NULL,
  PRIMARY KEY (broadcast_id, chunk_no)
);
