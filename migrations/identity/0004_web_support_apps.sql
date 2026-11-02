-- Support tickets (spec S-WEB-02) and runtime App status overrides (S-PLT-01).

-- Tickets from the support/report form. Deleted together with the member (S-ID-06);
-- anonymous tickets are removed one year after they are closed (daily maintenance).
CREATE TABLE support_tickets (
  ticket_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  user_id TEXT REFERENCES users (user_id) ON DELETE CASCADE,
  contact_email TEXT CHECK (contact_email IS NULL OR length(contact_email) <= 254),
  category TEXT NOT NULL CHECK (category IN ('question', 'account', 'purchase', 'report', 'other')),
  app_id TEXT,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  staff_note TEXT CHECK (staff_note IS NULL OR length(staff_note) <= 1000),
  -- SHA-256 of the client IP; only used to throttle anonymous submissions.
  ip_hash TEXT,
  closed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_support_tickets_status ON support_tickets (status, ticket_id);
CREATE INDEX idx_support_tickets_ip ON support_tickets (ip_hash, created_at);
CREATE INDEX idx_support_tickets_user ON support_tickets (user_id, created_at);

-- Owner/Admin can pause or kill a single App without a deploy; config/apps.json stays the default.
CREATE TABLE app_status_overrides (
  app_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'killed')),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE INDEX idx_audit_log_target ON audit_log (target_id, occurred_at);
