"""AI-3 R19 — *three distinct* disposable Auth, Task, and Battery SQLite DBs.
No real D1 or new migrations. Tests use actual R7 Battery wallet/hold/journal
constraints and real transactions; Auth/Task are strictly test-only projections.
Never proves global atomicity, signed AI-1 provenance, Queue ACK, or paid Battery.
"""
import pathlib
import sqlite3
import unittest

SCHEMA=pathlib.Path(__file__).resolve().parent.parent/'schema'
BATTERY_DRAFT=(SCHEMA/'0005_free_battery_DRAFT.sql').read_text()
SOURCE='auth_task_source_1234567890123456789'
AUTH_SQL=('SELECT member_ref,environment,status,auth_version,session_revoked,policy_version '
 'FROM ai3_r19_test_auth_projection WHERE member_ref=? AND environment=?')
TASK_SQL=('SELECT task_ref,member_ref,environment,source_event_ref,status,commit_attempt,'
 'completed_at_ms,policy_version FROM ai3_r19_test_task_projection '
 'WHERE task_ref=? AND member_ref=? AND environment=?')
BATTERY_SQL=(
 'SELECT h.task_ref,h.member_ref,h.status AS hold_status,h.created_ms,h.expires_ms,'
 'h.policy_version AS hold_policy_version,h.rate_version,h.price,'
 'w.balance,w.version AS wallet_version,w.revoked,'
 '(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id '
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='reserve') AS reserve_entries,"
 '(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id '
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_entries,"
 '(SELECT MAX(j.revision) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id '
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_revision,"
 '(SELECT MAX(j.balance_after) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id '
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_balance_after "
 'FROM ai3_battery_hold h JOIN ai3_battery_wallet w '
 "ON w.brand_id=h.brand_id AND w.member_ref=h.member_ref WHERE h.brand_id='starry' "
 'AND h.member_ref=? AND h.task_ref=?'
)
class R19ThreeIndependentDatabases(unittest.TestCase):
 def setUp(self):
  self.auth=sqlite3.connect(':memory:',isolation_level=None)
  self.task=sqlite3.connect(':memory:',isolation_level=None)
  self.battery=sqlite3.connect(':memory:',isolation_level=None)
  for db in (self.auth,self.task,self.battery):db.row_factory=sqlite3.Row
  self.auth.executescript('CREATE TABLE ai3_r19_test_auth_projection('
   'member_ref TEXT NOT NULL,environment TEXT NOT NULL,status TEXT NOT NULL,'
   'auth_version INTEGER NOT NULL,session_revoked INTEGER NOT NULL,'
   'policy_version INTEGER NOT NULL,PRIMARY KEY(member_ref,environment));'
   "INSERT INTO ai3_r19_test_auth_projection VALUES('member_1','staging','active',3,0,1);")
  self.task.executescript('CREATE TABLE ai3_r19_test_task_projection('
   'task_ref TEXT PRIMARY KEY,member_ref TEXT NOT NULL,environment TEXT NOT NULL,'
   'source_event_ref TEXT NOT NULL,status TEXT NOT NULL,'
   'commit_attempt INTEGER NOT NULL,completed_at_ms INTEGER NOT NULL,'
   'policy_version INTEGER NOT NULL);'
   "INSERT INTO ai3_r19_test_task_projection VALUES("
   "'task_1','member_1','staging','auth_task_source_1234567890123456789',"
   "'pending',1,110000,1);")
  self.battery.executescript(BATTERY_DRAFT)
  self.battery.execute('INSERT INTO ai3_battery_wallet '
   '(brand_id,member_ref,balance,registration_granted,version) '
   "VALUES ('starry','member_1',3,1,2)")
  self.battery.execute('INSERT INTO ai3_battery_hold VALUES '
   "('starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
  self.battery.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
   ('starry','member_1',1,'registration_1','registration_grant',10,10,'REGISTER_ONCE',1,100),
   ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000)])
 def tearDown(self):
  for db in (self.auth,self.task,self.battery):db.close()
 def rows(self):
  return (dict(self.auth.execute(AUTH_SQL,('member_1','staging')).fetchone()),
   dict(self.task.execute(TASK_SQL,('task_1','member_1','staging')).fetchone()),
   dict(self.battery.execute(BATTERY_SQL,('member_1','task_1')).fetchone()))
 def commit_task(self):
  self.task.execute("UPDATE ai3_r19_test_task_projection SET status='committed' "
   "WHERE task_ref='task_1'")
 def commit_wallet(self):
  self.battery.execute("UPDATE ai3_battery_hold SET status='committed' "
   "WHERE task_ref='task_1'")
  self.battery.execute('INSERT INTO ai3_battery_journal VALUES '
   "('starry','member_1',3,'task_1','commit',0,3,'TASK_COMMIT',1,110001)")
  self.battery.execute("UPDATE ai3_battery_wallet SET version=3 "
   "WHERE member_ref='member_1' AND version=2")
 def coherent(self):
  a,t,w=self.rows()
  return a['status']=='active' and a['session_revoked']==0 and (
   t['status']=='committed' and t['commit_attempt']==1 and
   t['policy_version']==a['policy_version']==w['hold_policy_version'] and
   w['revoked']==0 and w['hold_status']=='committed' and
   w['reserve_entries']==1 and w['commit_entries']==1 and
   w['commit_revision']==w['wallet_version'] and
   w['commit_balance_after']==w['balance'])
 def test_separate_three_connections_and_actual_r7_sql(self):
  self.assertIsNot(self.auth,self.task)
  self.assertIsNot(self.task,self.battery)
  self.assertIn('ai3_battery_journal',BATTERY_SQL)
  self.assertEqual(self.rows()[2]['reserve_entries'],1)
 def test_task_committed_before_wallet_receipt_denied(self):
  self.commit_task()
  self.assertFalse(self.coherent())
  self.assertEqual(self.rows()[2]['hold_status'],'held')
 def test_wallet_local_commit_does_not_commit_task_or_auth(self):
  self.commit_wallet()
  self.assertFalse(self.coherent())
  self.assertEqual(self.rows()[1]['status'],'pending')
 def test_matching_local_receipts_only_support_human_review(self):
  self.commit_task();self.commit_wallet()
  self.assertTrue(self.coherent())
  # No real AI1 signed proof, lawful KMS floor or Queue ACK in any DB.
  self.assertNotIn('signature',self.rows()[0])
  self.assertNotIn('signature',self.rows()[1])
 def test_member_deleted_after_task_commits_before_wallet_blocks(self):
  self.commit_task()
  self.auth.execute("UPDATE ai3_r19_test_auth_projection SET status='deleted',"
   "session_revoked=1,auth_version=4")
  self.commit_wallet()
  self.assertFalse(self.coherent())
 def test_reserve_timeout_180s_not_just_created_task_timestamp(self):
  w=self.rows()[2]
  self.assertEqual(w['expires_ms']-w['created_ms'],180000)
  self.assertTrue(w['expires_ms']<=200000)
  self.commit_task()
  self.assertFalse(self.coherent())
 def test_repeated_task_event_locally_unique_commit_journal(self):
  self.commit_task();self.commit_wallet()
  with self.assertRaises(sqlite3.IntegrityError):
   self.battery.execute('INSERT INTO ai3_battery_journal VALUES '
    "('starry','member_1',4,'task_1','commit',0,3,'DUPLICATE',1,110002)")
  self.assertEqual(self.rows()[2]['commit_entries'],1)
 def test_local_commit_transaction_crash_preserves_unsettled_hold(self):
  self.commit_task()
  self.battery.execute('BEGIN IMMEDIATE')
  self.commit_wallet()
  self.assertTrue(self.coherent())  # same local connection sees uncommitted rows
  self.battery.rollback()
  self.assertFalse(self.coherent())
  self.assertEqual(self.rows()[2]['commit_entries'],0)
 def test_lost_ack_after_local_commit_is_not_proof_of_external_ack(self):
  self.commit_task();self.commit_wallet()
  self.assertTrue(self.coherent())
  # Mock ACK delivery is not present; replay never introduces new commit.
  with self.assertRaises(sqlite3.IntegrityError):
   self.battery.execute('INSERT INTO ai3_battery_journal VALUES '
    "('starry','member_1',4,'task_1','commit',0,3,'REPLAY',1,110002)")
 def test_partial_sink_commit_persists_when_other_db_rolls_back(self):
  self.battery.execute('BEGIN IMMEDIATE')
  self.commit_task()
  self.commit_wallet()
  self.battery.rollback()
  self.assertEqual(self.rows()[1]['status'],'committed')
  self.assertEqual(self.rows()[2]['hold_status'],'held')
  self.assertFalse(self.coherent())
 def test_pitr_wallet_old_copy_below_separate_monotone_floor(self):
  old=sqlite3.connect(':memory:')
  old.row_factory=sqlite3.Row
  try:
   self.battery.backup(old)
   self.commit_task();self.commit_wallet()
   floor_version=self.rows()[2]['wallet_version']
   restored=old.execute(BATTERY_SQL,('member_1','task_1')).fetchone()
   self.assertLess(restored['wallet_version'],floor_version)
   self.assertEqual(restored['commit_entries'],0)
  finally:old.close()
 def test_signed_source_absent_even_if_all_local_receipts_valid(self):
  self.commit_task();self.commit_wallet()
  a,t,_=self.rows()
  self.assertTrue(self.coherent())
  self.assertNotIn('signed_issuer',a)
  self.assertNotIn('issuer_signature',t)
 def test_lawful_policy_drift_in_auth_projection_blocks_review(self):
  self.commit_task();self.commit_wallet()
  self.auth.execute('UPDATE ai3_r19_test_auth_projection SET policy_version=2')
  self.assertFalse(self.coherent())
 def test_duplicate_delivery_attempt_even_after_wallet_commit_blocks(self):
  self.commit_task();self.commit_wallet()
  self.task.execute('UPDATE ai3_r19_test_task_projection SET commit_attempt=2')
  self.assertFalse(self.coherent())
 def test_revoked_member_with_valid_old_task_receipt_blocks(self):
  self.commit_task();self.commit_wallet()
  self.battery.execute("UPDATE ai3_battery_wallet SET revoked=1,balance=0")
  self.assertFalse(self.coherent())
 def test_wrong_task_environment_does_not_match_starrey_auth_scope(self):
  self.task.execute("UPDATE ai3_r19_test_task_projection SET environment='development'")
  self.assertIsNone(self.task.execute(TASK_SQL,('task_1','member_1','staging')).fetchone())
 def test_no_paid_sku_or_battery_purchase_anywhere_in_draft(self):
  columns={c[1] for c in self.battery.execute('PRAGMA table_info(ai3_battery_wallet)')}
  self.assertFalse({'sku_id','product_id','store_purchase_id'} & columns)
  self.assertFalse(hasattr(self,'payment_db'))
if __name__=='__main__':unittest.main()
