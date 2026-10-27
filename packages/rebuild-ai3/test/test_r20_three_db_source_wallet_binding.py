"""R20 AI-3: actual THREE separate disposable SQLite databases.
Auth Task-source projection is NOT AI-1's authorized P05 publisher; AI-1's
real R19 account_deleted DTO is intentionally incompatible with Task commit.
Task is separate DB, Battery uses the original R7 0005 schema/constraints.
No true cross-D1 global commit, signer/KMS/PITR floor, Queue ACK, paid action.
"""
import pathlib
import sqlite3
import unittest

SCHEMA=pathlib.Path(__file__).resolve().parent.parent/'schema'
BATTERY=(SCHEMA/'0005_free_battery_DRAFT.sql').read_text()
AUTH_SQL=('SELECT brand_id,environment,member_ref,task_ref,event_ref,event_type,'
 'auth_version,attempt_no,policy_version,committed_at_ms FROM offline_auth_task_source '
 'WHERE member_ref=? AND task_ref=? AND environment=?')
TASK_SQL=('SELECT brand_id,environment,member_ref,task_ref,source_event_ref,status,'
 'attempt_no,policy_version,committed_at_ms FROM offline_task_sink '
 'WHERE member_ref=? AND task_ref=? AND environment=?')
WALLET_SQL=(
 'SELECT h.task_ref,h.member_ref,h.status AS hold_status,h.policy_version,'
 'w.revoked,w.balance,w.version AS wallet_revision,'
 "(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.member_ref=h.member_ref "
 "AND j.event_ref=h.task_ref AND j.kind='reserve') AS reserve_count,"
 "(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.member_ref=h.member_ref "
 "AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_count,"
 "(SELECT MAX(j.revision) FROM ai3_battery_journal j WHERE j.member_ref=h.member_ref "
 "AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_revision "
 'FROM ai3_battery_hold h JOIN ai3_battery_wallet w ON '
 "w.brand_id=h.brand_id AND w.member_ref=h.member_ref WHERE h.brand_id='starry' "
 'AND h.member_ref=? AND h.task_ref=?'
)
SOURCE='auth_task_source_1234567890123456789'
class R20SourceToTaskWalletSQLite(unittest.TestCase):
 def setUp(self):
  self.auth=sqlite3.connect(':memory:',isolation_level=None)
  self.task=sqlite3.connect(':memory:',isolation_level=None)
  self.wallet=sqlite3.connect(':memory:',isolation_level=None)
  for db in (self.auth,self.task,self.wallet):db.row_factory=sqlite3.Row
  self.auth.executescript(
   'CREATE TABLE offline_auth_task_source(brand_id TEXT,environment TEXT,'
   'member_ref TEXT,task_ref TEXT,event_ref TEXT,event_type TEXT,'
   'auth_version INTEGER,attempt_no INTEGER,policy_version INTEGER,'
   'committed_at_ms INTEGER,UNIQUE(member_ref,task_ref,event_ref));'
   "INSERT INTO offline_auth_task_source VALUES("
   "'starry','staging','member_1','task_1',"
   "'auth_task_source_1234567890123456789','task_committed',3,1,1,110000);")
  self.task.executescript(
   'CREATE TABLE offline_task_sink(brand_id TEXT,environment TEXT,'
   'member_ref TEXT,task_ref TEXT,source_event_ref TEXT,status TEXT,'
   'attempt_no INTEGER,policy_version INTEGER,committed_at_ms INTEGER,'
   'UNIQUE(member_ref,task_ref));'
   "INSERT INTO offline_task_sink VALUES("
   "'starry','staging','member_1','task_1',"
   "'auth_task_source_1234567890123456789','committed',1,1,110000);")
  self.wallet.executescript(BATTERY)
  self.wallet.execute("INSERT INTO ai3_battery_wallet "
   "(brand_id,member_ref,balance,registration_granted,version)"
   " VALUES('starry','member_1',3,1,2)")
  self.wallet.execute("INSERT INTO ai3_battery_hold VALUES("
   "'starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
  self.wallet.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
   ('starry','member_1',1,'registration_1','registration_grant',10,10,'REGISTER_ONCE',1,100),
   ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000)])
 def tearDown(self):
  for db in (self.auth,self.task,self.wallet):db.close()
 def source(self):
  x=self.auth.execute(AUTH_SQL,('member_1','task_1','staging')).fetchone()
  return dict(x) if x else None
 def task_receipt(self):
  x=self.task.execute(TASK_SQL,('member_1','task_1','staging')).fetchone()
  return dict(x) if x else None
 def battery_receipt(self,db=None):
  x=(db or self.wallet).execute(WALLET_SQL,('member_1','task_1')).fetchone()
  return dict(x) if x else None
 def settle_local(self):
  self.wallet.execute("UPDATE ai3_battery_hold SET status='committed' "
   "WHERE member_ref='member_1' AND task_ref='task_1'")
  self.wallet.execute("INSERT INTO ai3_battery_journal VALUES("
   "'starry','member_1',3,'task_1','commit',0,3,'TASK_COMMIT',1,110001)")
  self.wallet.execute("UPDATE ai3_battery_wallet SET version=3 "
   "WHERE member_ref='member_1' AND version=2")
 def mapped(self):
  a,t,w=self.source(),self.task_receipt(),self.battery_receipt()
  return bool(a and t and w and a['brand_id']==t['brand_id']=='starry' and
   a['environment']==t['environment']=='staging' and
   a['member_ref']==t['member_ref']==w['member_ref'] and
   a['task_ref']==t['task_ref']==w['task_ref'] and
   a['event_type']=='task_committed' and a['event_ref']==t['source_event_ref'] and
   a['attempt_no']==t['attempt_no']==1 and
   a['policy_version']==t['policy_version']==w['policy_version']==1 and
   a['committed_at_ms']==t['committed_at_ms'] and
   t['status']=='committed' and w['hold_status']=='committed' and
   w['revoked']==0 and w['reserve_count']==w['commit_count']==1 and
   w['commit_revision']==w['wallet_revision'])
 def test_three_real_independent_database_connections(self):
  self.assertIsNot(self.auth,self.task);self.assertIsNot(self.task,self.wallet)
  self.assertIn('ai3_battery_journal',WALLET_SQL)
 def test_local_complete_reconciles_only_in_mock_not_real_signed_p05(self):
  self.settle_local();self.assertTrue(self.mapped())
  self.assertNotIn('signed_provenance',self.source())
  self.assertNotIn('kms_rollback_anchor',self.task_receipt())
 def test_actual_account_deleted_event_cannot_be_task_committed(self):
  self.settle_local()
  self.auth.execute("UPDATE offline_auth_task_source SET event_type='account_deleted'")
  self.assertFalse(self.mapped())
 def test_foreign_billing_refund_cannot_be_task_event(self):
  self.settle_local()
  self.auth.execute("UPDATE offline_auth_task_source SET event_type='store_refund'")
  self.assertFalse(self.mapped())
 def test_source_event_ref_mismatch_with_task_db(self):
  self.settle_local()
  self.task.execute("UPDATE offline_task_sink SET source_event_ref='other_event_12345678901234567890'")
  self.assertFalse(self.mapped())
 def test_task_committed_and_wallet_hold_still_held(self):
  self.assertEqual(self.task_receipt()['status'],'committed')
  self.assertEqual(self.battery_receipt()['hold_status'],'held')
  self.assertFalse(self.mapped())
 def test_battery_local_commit_crash_and_task_survives(self):
  self.wallet.execute('BEGIN IMMEDIATE')
  self.settle_local();self.assertTrue(self.mapped())
  self.wallet.rollback()
  self.assertFalse(self.mapped());self.assertEqual(self.task_receipt()['status'],'committed')
 def test_task_source_changed_after_wallet_local_commit(self):
  self.settle_local();self.assertTrue(self.mapped())
  self.auth.execute("UPDATE offline_auth_task_source SET auth_version=4,policy_version=2")
  self.assertFalse(self.mapped())
 def test_source_member_changed_but_sink_old(self):
  self.settle_local()
  self.auth.execute("UPDATE offline_auth_task_source SET member_ref='member_2'")
  self.assertIsNone(self.source());self.assertFalse(self.mapped())
 def test_task_environment_changed_after_commit(self):
  self.settle_local()
  self.task.execute("UPDATE offline_task_sink SET environment='development'")
  self.assertIsNone(self.task_receipt());self.assertFalse(self.mapped())
 def test_task_duplicate_attempt_no_two_denied(self):
  self.settle_local()
  self.task.execute("UPDATE offline_task_sink SET attempt_no=2")
  self.assertFalse(self.mapped())
 def test_wallet_second_commit_journal_unique(self):
  self.settle_local()
  with self.assertRaises(sqlite3.IntegrityError):
   self.wallet.execute("INSERT INTO ai3_battery_journal VALUES("
    "'starry','member_1',4,'task_1','commit',0,3,'DUPLICATE',1,110002)")
  self.assertEqual(self.battery_receipt()['commit_count'],1)
 def test_pitr_old_wallet_snapshot_loses_durable_commit(self):
  old=sqlite3.connect(':memory:');old.row_factory=sqlite3.Row
  try:
   self.wallet.backup(old);self.settle_local()
   self.assertEqual(self.battery_receipt(old)['commit_count'],0)
   self.assertEqual(self.battery_receipt()['commit_count'],1)
  finally:old.close()
 def test_wallet_revocation_no_purchase(self):
  self.settle_local()
  self.wallet.execute("UPDATE ai3_battery_wallet SET revoked=1,balance=0")
  self.assertFalse(self.mapped())
  columns={x[1] for x in self.wallet.execute('PRAGMA table_info(ai3_battery_wallet)')}
  self.assertNotIn('store_sku',columns)
 def test_source_db_commit_does_not_automatically_commit_wallet_db(self):
  self.assertEqual(self.source()['event_type'],'task_committed')
  self.assertEqual(self.battery_receipt()['commit_count'],0)
  self.assertFalse(self.mapped())
if __name__=='__main__':unittest.main()
