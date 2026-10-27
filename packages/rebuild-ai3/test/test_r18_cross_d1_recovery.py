"""AI-3 R18 three separate *disposable* SQLite DB negative tests.
Battery SQL is the exact existing 0005 + 0010 draft. Independent Task and
floor are test-only local projections, NOT a KMS/notary, Queue or D1 migration.
"""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parent.parent/'schema'
BATTERY_SQL=(ROOT/'0005_free_battery_DRAFT.sql').read_text()+'\n'+(
 ROOT/'0010_auth_delete_battery_inbox_DRAFT.sql').read_text()
EVENT='delete_event_12345678901234567890'
APPLY=('INSERT INTO ai3_r14_deletion_inbox '
 '(brand_id,environment,event_id,member_ref,event_type,occurred_at_ms,policy_version,applied)'
 ' VALUES (?,?,?,?,?,?,?,0)')
RECEIPT=(
 "SELECT i.event_id,i.member_ref,i.event_type,i.occurred_at_ms,i.policy_version,"
 "i.applied,w.revoked,w.balance,w.version AS wallet_version,"
 "j.revision AS journal_revision,j.kind,j.delta,j.balance_after,j.reason_code,"
 "(SELECT COUNT(*) FROM ai3_battery_hold h WHERE h.brand_id=i.brand_id "
 "AND h.member_ref=i.member_ref AND h.status='held') AS pending_holds "
 "FROM ai3_r14_deletion_inbox i JOIN ai3_battery_wallet w "
 "ON w.brand_id=i.brand_id AND w.member_ref=i.member_ref "
 "JOIN ai3_battery_journal j ON j.brand_id=i.brand_id "
 "AND j.member_ref=i.member_ref AND j.event_ref=i.event_id AND j.kind='revoke' "
 "WHERE i.brand_id='starry' AND i.environment=? AND i.event_id=? "
 "AND i.member_ref=? AND i.occurred_at_ms=?"
)
class CrossD1R18(unittest.TestCase):
 def setUp(self):
  self.b=sqlite3.connect(':memory:',isolation_level=None)
  self.t=sqlite3.connect(':memory:',isolation_level=None)
  self.w=sqlite3.connect(':memory:',isolation_level=None)
  for db in (self.b,self.t,self.w):db.row_factory=sqlite3.Row
  self.b.executescript(BATTERY_SQL)
  self.b.execute("INSERT INTO ai3_battery_wallet "
   "(brand_id,member_ref,balance,registration_granted,version) "
   "VALUES ('starry','member_1',3,1,2)")
  self.b.execute("INSERT INTO ai3_battery_hold VALUES "
   "('starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
  self.b.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
   ('starry','member_1',1,'initial_registration','registration_grant',10,10,'REGISTER_ONCE',1,100),
   ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000)])
  self.t.executescript("CREATE TABLE ai3_r18_offline_task_projection("
   "task_ref TEXT PRIMARY KEY,member_ref TEXT NOT NULL,"
   "environment TEXT NOT NULL,status TEXT NOT NULL);"
   "INSERT INTO ai3_r18_offline_task_projection VALUES"
   "('task_1','member_1','staging','cancelled');")
  self.w.executescript("CREATE TABLE independent_offline_floor("
   "event_id TEXT PRIMARY KEY,member_ref TEXT NOT NULL,"
   "environment TEXT NOT NULL,occurred_at_ms INTEGER NOT NULL,"
   "policy_version INTEGER NOT NULL,minimum_wallet_revision INTEGER NOT NULL,"
   "revoked INTEGER NOT NULL,recorded_at_ms INTEGER NOT NULL,"
   "witness_revision INTEGER NOT NULL);")
 def tearDown(self):
  for db in (self.b,self.t,self.w):db.close()
 def apply(self):
  self.b.execute(APPLY,('starry','staging',EVENT,'member_1','account_deleted',110000,1))
 def receipt(self,db=None):
  row=(db or self.b).execute(RECEIPT,('staging',EVENT,'member_1',110000)).fetchone()
  return dict(row) if row is not None else None
 def witness(self,revision=3,policy=1):
  self.w.execute("INSERT INTO independent_offline_floor VALUES(?,?,?,?,?,?,?,?,?)",
   (EVENT,'member_1','staging',110000,policy,revision,1,110100,1))
 def floor(self):
  row=self.w.execute("SELECT * FROM independent_offline_floor").fetchone()
  return dict(row) if row else None
 def hold_state(self):
  return self.b.execute("SELECT status FROM ai3_battery_hold "
   "WHERE member_ref='member_1' AND task_ref='task_1'").fetchone()[0]
 def task_state(self):
  return self.t.execute("SELECT status FROM ai3_r18_offline_task_projection "
   "WHERE task_ref='task_1'").fetchone()[0]
 def test_three_physically_distinct_sqlite_connections_no_atomic_cross_commit(self):
  self.assertIsNot(self.b,self.t)
  self.assertIsNot(self.w,self.b)
  self.apply();self.witness()
  self.assertEqual(self.receipt()['wallet_version'],3)
  self.assertEqual(self.floor()['minimum_wallet_revision'],3)
  self.assertEqual(self.hold_state(),'revoked')
  self.assertEqual(self.task_state(),'cancelled')
 def test_task_committed_but_wallet_not_settled_is_detectable(self):
  self.t.execute("UPDATE ai3_r18_offline_task_projection SET status='committed'")
  self.assertEqual(self.task_state(),'committed')
  self.assertEqual(self.hold_state(),'held') # no cross-DB atomicity
  self.apply()
  self.assertEqual(self.hold_state(),'revoked') # local deletion is NOT Task settlement
  self.assertNotEqual(self.hold_state(),'committed')
 def test_pitr_wallet_before_revocation_conflicts_with_newer_separate_floor(self):
  old=sqlite3.connect(':memory:')
  try:
   self.b.backup(old) # snapshot *before* deletion, still grants access
   self.apply();self.witness()
   self.assertIsNone(self.receipt(old))
   self.assertEqual(old.execute("SELECT revoked FROM ai3_battery_wallet").fetchone()[0],0)
   self.assertEqual(self.floor()['minimum_wallet_revision'],3)
   self.assertIsNotNone(self.receipt())
  finally:old.close()
 def test_pitr_floor_ahead_of_local_revision_never_proves_recovery(self):
  self.apply();self.witness(revision=4)
  self.assertGreater(self.floor()['minimum_wallet_revision'],
   self.receipt()['wallet_version'])
 def test_missing_independent_witness_even_when_local_receipt_exists(self):
  self.apply()
  self.assertIsNotNone(self.receipt())
  self.assertIsNone(self.floor()) # cannot authorize a restore or queue ACK
 def test_deleted_inbox_cannot_be_removed_or_wallet_regranted(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("DELETE FROM ai3_r14_deletion_inbox WHERE event_id=?",(EVENT,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("UPDATE ai3_battery_wallet SET balance=10,revoked=0 "
    "WHERE member_ref='member_1'")
  self.assertEqual(self.receipt()['revoked'],1)
 def test_source_deletion_local_crash_rolls_back_without_false_receipt(self):
  self.b.execute("BEGIN IMMEDIATE")
  self.apply()
  self.assertIsNotNone(self.receipt())
  self.b.rollback()
  self.assertIsNone(self.receipt())
  self.assertEqual(self.hold_state(),'held')
 def test_replay_concurrent_commit_is_unique_local_only(self):
  self.apply()
  before=self.b.execute("SELECT COUNT(*) FROM ai3_battery_journal").fetchone()[0]
  with self.assertRaises(sqlite3.IntegrityError):self.apply()
  self.assertEqual(self.b.execute("SELECT COUNT(*) FROM ai3_battery_journal")
   .fetchone()[0],before)
  self.assertEqual(self.receipt()['wallet_version'],3)
 def test_lawful_policy_drift_visible_between_sink_and_witness(self):
  self.apply();self.witness(policy=2)
  self.assertNotEqual(self.receipt()['policy_version'],self.floor()['policy_version'])
 def test_post_delete_new_task_cannot_create_hold_or_journal(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("INSERT INTO ai3_battery_hold VALUES "
    "('starry','member_1','task_2','starry-ai','chat',1,1,1,110000,290000,'held')")
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("INSERT INTO ai3_battery_journal VALUES "
    "('starry','member_1',4,'task_2','first_task_grant',100,100,'FAKE_GRANT',1,110010)")
 def test_floor_cross_environment_not_same_delete_proof(self):
  self.apply();self.witness()
  self.w.execute("UPDATE independent_offline_floor SET environment='development'")
  self.assertNotEqual(self.floor()['environment'],'staging')
 def test_independent_floor_is_test_only_not_signed_attestation(self):
  self.witness()
  cols={x[1] for x in self.w.execute("PRAGMA table_info(independent_offline_floor)")}
  self.assertNotIn('kms_signature',cols)
  self.assertNotIn('oauth_sub',cols)
  self.assertNotIn('provider_token',cols)
if __name__=='__main__':unittest.main()
