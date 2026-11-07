-- App staff now come in two kinds: 'manager' (remote config and read-only product views, as before) and
-- 'support' (read tickets and members of that App only, and reply). Existing rows stay managers.
ALTER TABLE app_staff ADD COLUMN kind TEXT NOT NULL DEFAULT 'manager' CHECK (kind IN ('manager', 'support'));
