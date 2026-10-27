-- R14 AI-1: extra scope, verified-step-up and duplicate issuance fences.
-- OFFLINE disposable SQLite :memory: only, NEVER live Cloudflare D1.
-- Prerequisites: schema 001, 007, 011. Identity/billing never co-located.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS starry_deletion_challenge_scope(
 challenge_ref TEXT PRIMARY KEY REFERENCES starry_deletion_challenges(challenge_ref),
 app_id TEXT NOT NULL CHECK(length(app_id)>0),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 method TEXT NOT NULL CHECK(method IN ('passkey','totp')),
 verified_at INTEGER NOT NULL CHECK(verified_at>=0)
);
-- In production a separate trusted backend must have cryptographically
-- verified the Passkey/TOTP step-up before updating Session authority.
-- Prevent concurrent issuers creating two active challenges on one Session.
CREATE TRIGGER IF NOT EXISTS trg_r14_issuance_current_stepup
 BEFORE INSERT ON starry_deletion_challenges
 BEGIN
  SELECT CASE WHEN NOT EXISTS(
   SELECT 1 FROM starry_members m JOIN starry_sessions s ON s.s_user_id=m.s_user_id
   WHERE m.s_user_id=NEW.s_user_id AND m.status='active'
    AND m.auth_version=NEW.auth_version AND
    s.session_id=NEW.session_id AND s.auth_version=m.auth_version
    AND s.app_id<>'' AND s.environment IN ('development','staging')
    AND s.revoked_at IS NULL AND s.expires_at>NEW.created_at
    AND s.step_up_method IN ('passkey','totp')
    AND s.step_up_verified_at>=NEW.created_at-300
    AND s.step_up_verified_at<=NEW.created_at
    AND s.step_up_expires_at>NEW.created_at
    AND NEW.expires_at<=s.step_up_expires_at
    AND NEW.expires_at<=s.expires_at
  ) THEN RAISE(ABORT,'DELETE_ISSUE_STEPUP_INVALID') END;
  SELECT CASE WHEN EXISTS(
   SELECT 1 FROM starry_deletion_challenges c
   WHERE c.s_user_id=NEW.s_user_id AND c.session_id=NEW.session_id
   AND c.consumed_at IS NULL AND c.expires_at>NEW.created_at
  ) THEN RAISE(ABORT,'DELETE_ISSUE_ACTIVE_CHALLENGE_EXISTS') END;
 END;
CREATE TRIGGER IF NOT EXISTS trg_r14_issue_bind_scope
 AFTER INSERT ON starry_deletion_challenges
 BEGIN
 INSERT INTO starry_deletion_challenge_scope
 (challenge_ref,app_id,environment,method,verified_at)
 SELECT NEW.challenge_ref,s.app_id,s.environment,s.step_up_method,s.step_up_verified_at
 FROM starry_sessions s
 WHERE s.session_id=NEW.session_id AND s.s_user_id=NEW.s_user_id
 AND s.auth_version=NEW.auth_version AND s.step_up_method IN ('passkey','totp')
 AND s.environment IN ('development','staging');
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM starry_deletion_challenge_scope
  WHERE challenge_ref=NEW.challenge_ref
 ) THEN RAISE(ABORT,'DELETE_ISSUE_SCOPE_UNAVAILABLE') END;
 END;
-- Extra independent guard. The existing R13 member/session/CAS trigger remains
-- in effect. A new step-up or revoked Session invalidates an old challenge.
CREATE TRIGGER IF NOT EXISTS trg_r14_consumption_requires_same_stepup
 BEFORE UPDATE OF consumed_at ON starry_deletion_challenges
 WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
 BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM starry_deletion_challenge_scope a
  JOIN starry_sessions s ON s.session_id=NEW.session_id
  WHERE a.challenge_ref=NEW.challenge_ref
   AND a.app_id=s.app_id AND a.environment=s.environment
   AND a.method=s.step_up_method AND a.verified_at=s.step_up_verified_at
   AND s.s_user_id=NEW.s_user_id AND s.auth_version=NEW.auth_version
   AND s.revoked_at IS NULL AND s.expires_at>NEW.consumed_at
   AND s.step_up_verified_at>=NEW.consumed_at-300
   AND s.step_up_verified_at<=NEW.consumed_at
   AND s.step_up_expires_at>NEW.consumed_at
 ) THEN RAISE(ABORT,'DELETE_CONSUME_STEPUP_SCOPE_INVALID') END;
 END;
COMMIT;
