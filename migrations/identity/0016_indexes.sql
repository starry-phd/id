-- Indexes for the busiest Admin Lite and dashboard queries once there are tens of Apps and many members.
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_app ON audit_log (app_id, audit_id);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_app_used ON sessions (app_id, last_used_at);
CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON profiles (display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON auth_identities (email COLLATE NOCASE);
