-- Member profile fields restored from the original checklist 02.01-02.10 (owner, 2026-11-03).
-- Starry ID stores them once for every Starry App. Visibility is per field (02.09); the phone
-- number is optional, one per member, E.164, not unique and never used to merge accounts (02.02).

-- 02.01 main contact email (separate from the sign-in emails; used for system email once verified).
ALTER TABLE profiles ADD COLUMN contact_email TEXT CHECK (contact_email IS NULL OR (length(contact_email) BETWEEN 6 AND 254 AND contact_email = lower(contact_email)));
ALTER TABLE profiles ADD COLUMN contact_email_verified_at INTEGER;
-- 02.02 phone, E.164 such as +886912345678.
ALTER TABLE profiles ADD COLUMN phone TEXT CHECK (phone IS NULL OR (phone GLOB '+[1-9]*' AND length(phone) BETWEEN 8 AND 16));
-- 02.01 country (ISO 3166-1 alpha-2), state/province/county and city.
ALTER TABLE profiles ADD COLUMN country TEXT CHECK (country IS NULL OR (length(country) = 2 AND country GLOB '[A-Z][A-Z]'));
ALTER TABLE profiles ADD COLUMN region TEXT CHECK (region IS NULL OR length(region) BETWEEN 1 AND 60);
ALTER TABLE profiles ADD COLUMN city TEXT CHECK (city IS NULL OR length(city) BETWEEN 1 AND 60);
-- 02.05 motto.
ALTER TABLE profiles ADD COLUMN motto TEXT CHECK (motto IS NULL OR length(motto) BETWEEN 1 AND 200);
-- 02.09 per-field visibility, JSON {"field": "public" | "private"}; missing fields use the defaults.
ALTER TABLE profiles ADD COLUMN visibility TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(visibility));

-- 02.10 when each field was last changed and by whom (the member or Starry staff); values are
-- never kept here, the audit log has the events.
CREATE TABLE profile_field_updates (
  user_id TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('member', 'staff')),
  PRIMARY KEY (user_id, field)
);
