-- Extra member profile fields (2026-11-07): nickname (always public), occupation, organization,
-- website, bio, languages, interests, skills and education; plus the member's Google photo URL
-- so the account page can offer "use my Google avatar".
ALTER TABLE profiles ADD COLUMN nickname TEXT;
ALTER TABLE profiles ADD COLUMN occupation TEXT;
ALTER TABLE profiles ADD COLUMN organization TEXT;
ALTER TABLE profiles ADD COLUMN website TEXT;
ALTER TABLE profiles ADD COLUMN bio TEXT;
ALTER TABLE profiles ADD COLUMN languages TEXT;
ALTER TABLE profiles ADD COLUMN interests TEXT;
ALTER TABLE profiles ADD COLUMN skills TEXT;
ALTER TABLE profiles ADD COLUMN university TEXT;
ALTER TABLE profiles ADD COLUMN university_dept TEXT;
ALTER TABLE profiles ADD COLUMN grad_school TEXT;
ALTER TABLE profiles ADD COLUMN grad_dept TEXT;
ALTER TABLE auth_identities ADD COLUMN photo_url TEXT;
