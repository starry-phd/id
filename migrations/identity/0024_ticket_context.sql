-- Where a support ticket came from: the App version and device model an App passes when it opens the support form.
-- Both are optional, short, plain text; staff see them next to the member number.
ALTER TABLE support_tickets ADD COLUMN app_version TEXT;
ALTER TABLE support_tickets ADD COLUMN device TEXT;
CREATE INDEX idx_support_tickets_app ON support_tickets (app_id, status, ticket_id);
