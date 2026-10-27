-- AI-3 R14: disposable SQLite :memory: DRAFT only; NOT a live migration.
-- Depends on 0005_free_battery_DRAFT.sql (wallet, hold, append journal).
-- An AI-1 Auth deletion event is committed in a DIFFERENT D1. This is
-- ONLY the Battery-local atomic consumption of trusted durable outbox data.
PRAGMA foreign_keys=ON;
CREATE TABLE ai3_r14_deletion_inbox (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 environment TEXT NOT NULL CHECK(environment IN ('development','staging')),
 event_id TEXT NOT NULL UNIQUE CHECK(length(event_id) BETWEEN 20 AND 180),
 member_ref TEXT NOT NULL UNIQUE REFERENCES ai3_battery_wallet(member_ref),
 event_type TEXT NOT NULL CHECK(event_type='account_deleted'),
 occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms>=0),
 policy_version INTEGER NOT NULL CHECK(policy_version>=1),
 applied INTEGER NOT NULL DEFAULT 0 CHECK(applied IN (0,1)),
 PRIMARY KEY(brand_id,environment,event_id)
);
-- A spent Member tombstone is NOT revivable by any future wallet update.
CREATE TRIGGER ai3_r14_wallet_no_unrevoke BEFORE UPDATE ON ai3_battery_wallet
 WHEN OLD.revoked=1
 BEGIN SELECT RAISE(ABORT,'BATTERY_REVOKED_MEMBER_IMMUTABLE'); END;
CREATE TRIGGER ai3_r14_wallet_no_recreate BEFORE INSERT ON ai3_battery_wallet
 WHEN EXISTS(SELECT 1 FROM ai3_r14_deletion_inbox WHERE member_ref=NEW.member_ref)
 BEGIN SELECT RAISE(ABORT,'BATTERY_DELETED_MEMBER_RECREATE'); END;
CREATE TRIGGER ai3_r14_inbox_no_delete BEFORE DELETE ON ai3_r14_deletion_inbox
 BEGIN SELECT RAISE(ABORT,'BATTERY_DELETE_RETENTION_GATE'); END;
CREATE TRIGGER ai3_r14_inbox_no_rewrite BEFORE UPDATE ON ai3_r14_deletion_inbox
 WHEN NOT (
  OLD.applied=0 AND NEW.applied=1 AND
  OLD.brand_id=NEW.brand_id AND OLD.environment=NEW.environment AND
  OLD.event_id=NEW.event_id AND OLD.member_ref=NEW.member_ref AND
  OLD.event_type=NEW.event_type AND OLD.occurred_at_ms=NEW.occurred_at_ms AND
  OLD.policy_version=NEW.policy_version
 )
 BEGIN SELECT RAISE(ABORT,'BATTERY_DELETE_INBOX_IMMUTABLE'); END;
CREATE TRIGGER ai3_r14_inbox_before_insert BEFORE INSERT ON ai3_r14_deletion_inbox
 BEGIN
  SELECT CASE WHEN NOT EXISTS(
   SELECT 1 FROM ai3_battery_wallet w
   WHERE w.member_ref=NEW.member_ref AND w.brand_id='starry' AND
     w.revoked=0 AND w.version<9007199254740991
  ) THEN RAISE(ABORT,'BATTERY_WALLET_MISSING_OR_REVOKED') END;
 END;
-- An INSERT causes the following writes in ONE SQLite statement transaction.
-- Any constraint error or missing CAS rolls back *all* writes including inbox.
CREATE TRIGGER ai3_r14_inbox_apply_delete AFTER INSERT ON ai3_r14_deletion_inbox
 BEGIN
  INSERT INTO ai3_battery_journal
    (brand_id,member_ref,revision,event_ref,kind,delta,balance_after,
     reason_code,policy_version,at_ms)
   SELECT 'starry',w.member_ref,w.version+1,NEW.event_id,'revoke',
    -w.balance,0,'ACCOUNT_DELETED',NEW.policy_version,NEW.occurred_at_ms
   FROM ai3_battery_wallet w
   WHERE w.member_ref=NEW.member_ref AND w.brand_id='starry' AND w.revoked=0;
  SELECT CASE WHEN changes()!=1
   THEN RAISE(ABORT,'BATTERY_REVOKE_JOURNAL_MISSING') END;
  UPDATE ai3_battery_hold SET status='revoked'
   WHERE brand_id='starry' AND member_ref=NEW.member_ref AND status='held';
  UPDATE ai3_battery_wallet SET balance=0,overdraft_used=0,
   revoked=1,version=version+1
   WHERE member_ref=NEW.member_ref AND brand_id='starry' AND revoked=0
    AND EXISTS(SELECT 1 FROM ai3_battery_journal j
     WHERE j.member_ref=NEW.member_ref AND j.event_ref=NEW.event_id AND
     j.kind='revoke' AND j.revision=ai3_battery_wallet.version+1);
  SELECT CASE WHEN changes()!=1
   THEN RAISE(ABORT,'BATTERY_WALLET_REVOKE_CAS_FAILED') END;
  UPDATE ai3_r14_deletion_inbox SET applied=1
   WHERE brand_id='starry' AND environment=NEW.environment AND
    event_id=NEW.event_id AND applied=0;
  SELECT CASE WHEN changes()!=1
   THEN RAISE(ABORT,'BATTERY_DELETE_INBOX_COMMIT_FAILED') END;
 END;
-- No raw OAuth identifiers, session tokens or personal message content.
-- Tombstone retention/erasure remains LEGAL Gate; never auto-purge.
