-- Central Apple Developer Team ID: one D1 row inherited by every App.
-- ADDITIVE migration: no changes to members, Passkeys, Battery, Billing, sessions or App identifiers.
-- Seed from the owner's confirmed existing Team ID. Worker STARRY_APPLE_TEAM_ID remains an emergency fallback.
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY CHECK (key = 'apple_team_id'),
  value TEXT NOT NULL CHECK (length(value) = 10 AND value NOT GLOB '*[^A-Z0-9]*'),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
INSERT OR IGNORE INTO platform_settings (key, value, updated_at, updated_by)
VALUES ('apple_team_id', '4W7QRTXN5Y', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL);

-- An older App-specific Team ID cannot override the owner's single central Team. Normalize legacy registrations
-- without altering their IDs, audiences, scopes, origins, status or other settings. Only valid JSON is touched.
UPDATE registered_apps
SET definition = json_set(definition, '$.ios_team_id', NULL)
WHERE json_valid(definition) AND json_type(definition, '$.ios_team_id') = 'text';
