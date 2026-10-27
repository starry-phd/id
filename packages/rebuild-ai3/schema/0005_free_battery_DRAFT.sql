-- R7 AI-3 OFFLINE DRAFT only. No Cloudflare D1 migrations, paid Battery, FEFO or expiry.
PRAGMA foreign_keys=ON;
CREATE TABLE ai3_battery_wallet (
 brand_id TEXT NOT NULL DEFAULT 'starry' CHECK(brand_id='starry'),
 member_ref TEXT PRIMARY KEY,
 balance INTEGER NOT NULL DEFAULT 0,
 overdraft_used INTEGER NOT NULL DEFAULT 0 CHECK(overdraft_used BETWEEN 0 AND 2),
 registration_granted INTEGER NOT NULL DEFAULT 0 CHECK(registration_granted IN (0,1)),
 first_task_granted INTEGER NOT NULL DEFAULT 0 CHECK(first_task_granted IN (0,1)),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 CHECK(first_task_granted <= registration_granted),
 CHECK(revoked=0 OR balance=0)
);
CREATE TABLE ai3_battery_hold (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 member_ref TEXT NOT NULL REFERENCES ai3_battery_wallet(member_ref),
 task_ref TEXT NOT NULL,
 app_id TEXT NOT NULL,
 task_type TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price>0),
 rate_version INTEGER NOT NULL CHECK(rate_version>0),
 policy_version INTEGER NOT NULL CHECK(policy_version>0),
 created_ms INTEGER NOT NULL CHECK(created_ms>=0),
 expires_ms INTEGER NOT NULL CHECK(expires_ms=created_ms+180000),
 status TEXT NOT NULL CHECK(status IN ('held','committed','released','expired','revoked')),
 PRIMARY KEY(member_ref,task_ref)
);
CREATE TABLE ai3_battery_journal (
 brand_id TEXT NOT NULL CHECK(brand_id='starry'),
 member_ref TEXT NOT NULL REFERENCES ai3_battery_wallet(member_ref),
 revision INTEGER NOT NULL CHECK(revision>=1),
 event_ref TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('registration_grant','first_task_grant','reserve',
 'commit','release','expire','admin_correction','revoke')),
 delta INTEGER NOT NULL,
 balance_after INTEGER NOT NULL,
 reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 3 AND 64),
 policy_version INTEGER NOT NULL CHECK(policy_version>0),
 at_ms INTEGER NOT NULL CHECK(at_ms>=0),
 PRIMARY KEY(member_ref,revision),
 UNIQUE(member_ref,kind,event_ref)
);
CREATE TRIGGER ai3_battery_journal_no_update BEFORE UPDATE ON ai3_battery_journal
 BEGIN SELECT RAISE(ABORT,'BATTERY_APPEND_ONLY'); END;
CREATE TRIGGER ai3_battery_journal_no_delete BEFORE DELETE ON ai3_battery_journal
 BEGIN SELECT RAISE(ABORT,'BATTERY_RETENTION_GATE'); END;
-- Future writer must CAS wallet.version and atomically update hold+wallet+journal.
-- Never settle a 'held' hold after expires_ms <= server_now_ms.
-- Real grants require AI-1 lawful anti-repeat evidence; store no raw provider IDs.
-- X/Y quantities, rates, debt cap, independent backups and legal retention are GATES.
