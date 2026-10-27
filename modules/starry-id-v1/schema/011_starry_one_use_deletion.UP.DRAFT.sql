-- AI-1 R13 Q88 disposable SQLite :memory: DRAFT; never apply live D1.
-- Depends on 001 (member/session), 007 (deletion outbox/no revival).
-- The verified backend must INSERT a crypto-random 256-bit challenge_ref and
-- unique event_id ONLY after independent Passkey/TOTP second-factor proof.
-- No challenge proof, OTP, OAuth sub, IP, email or refresh token is persisted.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS starry_deletion_challenges(
 challenge_ref TEXT PRIMARY KEY
  CHECK(length(challenge_ref)=64 AND challenge_ref NOT GLOB '*[^0-9a-f]*'),
 s_user_id TEXT NOT NULL REFERENCES starry_members(s_user_id),
 session_id TEXT NOT NULL REFERENCES starry_sessions(session_id),
 auth_version INTEGER NOT NULL CHECK(auth_version>=1),
 event_id TEXT NOT NULL UNIQUE CHECK(length(event_id) BETWEEN 20 AND 180),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+300),
 consumed_at INTEGER CHECK(consumed_at IS NULL OR
  (consumed_at>=created_at AND consumed_at<expires_at))
);
CREATE INDEX IF NOT EXISTS idx_r13_delete_pending_member
 ON starry_deletion_challenges(s_user_id,session_id,expires_at)
 WHERE consumed_at IS NULL;
-- Immutable consumed proofs. A client cannot reset a spent challenge.
CREATE TRIGGER IF NOT EXISTS trg_r13_delete_challenge_no_rewind
 BEFORE UPDATE OF consumed_at ON starry_deletion_challenges
 WHEN OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
 BEGIN SELECT RAISE(ABORT,'DELETE_CHALLENGE_ALREADY_USED'); END;
-- Re-check current Member and Session INSIDE the consuming SQL statement,
-- closing the read-then-delete gap without relying on the prior JS snapshot.
CREATE TRIGGER IF NOT EXISTS trg_r13_delete_challenge_guard
 BEFORE UPDATE OF consumed_at ON starry_deletion_challenges
 WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
 BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM starry_members m JOIN starry_sessions s
   ON s.s_user_id=m.s_user_id
  WHERE m.s_user_id=NEW.s_user_id AND m.status='active'
   AND m.auth_version=NEW.auth_version
   AND m.auth_version<9007199254740991 AND m.profile_revision<9007199254740991
   AND s.session_id=NEW.session_id AND s.auth_version=NEW.auth_version
   AND s.revoked_at IS NULL AND s.expires_at>NEW.consumed_at
   AND s.environment IN ('development','staging')
 ) THEN RAISE(ABORT,'DELETE_MEMBER_OR_SESSION_INVALID') END;
 END;
-- The single UPDATE and all these trigger changes form ONE SQLite statement:
-- constraint failure (e.g., duplicate event_id) rolls back ALL four writes.
CREATE TRIGGER IF NOT EXISTS trg_r13_atomic_delete_once
 AFTER UPDATE OF consumed_at ON starry_deletion_challenges
 WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
 BEGIN
 UPDATE starry_members SET status='deleted',auth_version=auth_version+1,
  profile_revision=profile_revision+1,display_name=NULL,
  directory_opt_in=0,display_name_public=0,updated_at=NEW.consumed_at
  WHERE s_user_id=NEW.s_user_id AND status='active' AND auth_version=NEW.auth_version;
 UPDATE starry_sessions SET revoked_at=NEW.consumed_at
  WHERE s_user_id=NEW.s_user_id AND revoked_at IS NULL;
 INSERT INTO starry_deletion_outbox(event_id,s_user_id,occurred_at,event_type)
  VALUES (NEW.event_id,NEW.s_user_id,NEW.consumed_at,'account_deleted');
 END;
COMMIT;
