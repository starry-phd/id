-- Last time a member used each App (login or token refresh, written at most hourly), so Admin Lite can show
-- which Apps really have users. Starts equal to the latest session use.
ALTER TABLE member_apps ADD COLUMN last_seen_at INTEGER;
UPDATE member_apps SET last_seen_at = COALESCE((SELECT MAX(s.last_used_at) FROM sessions s WHERE s.user_id = member_apps.user_id AND s.app_id = member_apps.app_id), first_seen_at);
CREATE INDEX idx_member_apps_seen ON member_apps (app_id, last_seen_at);
