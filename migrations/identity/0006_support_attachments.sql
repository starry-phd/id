-- Spec S-WEB-02: optional attachment on a support ticket, stored in the private R2 bucket
-- SUPPORT_FILES. Rows go away with their ticket (member purge, ticket retention); the trigger
-- queues the R2 object for deletion so no file outlives its ticket.
CREATE TABLE support_attachments (
  attachment_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets (ticket_id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_support_attachments_ticket ON support_attachments (ticket_id);

-- R2 objects whose database row is gone; the daily Cron deletes them and clears the row.
CREATE TABLE r2_deletions (
  object_key TEXT PRIMARY KEY,
  bucket TEXT NOT NULL CHECK (bucket IN ('support')),
  queued_at INTEGER NOT NULL
);

CREATE TRIGGER support_attachments_queue_delete AFTER DELETE ON support_attachments
BEGIN
  INSERT OR IGNORE INTO r2_deletions (object_key, bucket, queued_at)
  VALUES (OLD.object_key, 'support', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
END;
