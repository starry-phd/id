-- The member's chosen "primary display name": the nickname or the real name, exactly one of them.
-- Existing members keep today's behaviour (nickname first), so the default is 'nickname'.
ALTER TABLE profiles ADD COLUMN primary_name TEXT NOT NULL DEFAULT 'nickname' CHECK (primary_name IN ('nickname', 'display_name'));
