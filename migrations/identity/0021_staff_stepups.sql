-- A staff member who has a passkey must confirm high-risk Admin Lite actions (delete a member, adjust Battery,
-- regenerate a service key, change a role) with it. The confirmation is remembered for 5 minutes per web session.
CREATE TABLE staff_stepups (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
