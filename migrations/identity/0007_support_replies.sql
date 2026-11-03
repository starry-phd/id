-- Spec S-WEB-02 / S-NTF-02: staff replies to a support ticket, sent by email from Admin Lite.
-- Kept with the ticket (deleted with it); the delivery result is stored for follow-up.
CREATE TABLE support_ticket_replies (
  reply_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets (ticket_id) ON DELETE CASCADE,
  staff_user_id TEXT REFERENCES users (user_id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  delivery TEXT NOT NULL CHECK (delivery IN ('sent', 'failed')),
  message_id TEXT,
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 64),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_support_ticket_replies_ticket ON support_ticket_replies (ticket_id, created_at);
