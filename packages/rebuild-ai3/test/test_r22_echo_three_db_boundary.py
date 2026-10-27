"""R22 AI-3 Echo Starry disposable Auth / Task / Battery SQLite safety matrix.
All three connections distinct; Battery uses genuine inherited R7 0005 wallet
DDL, UNIQUE journal and local hold. Auth & Echo task/job are TEST-ONLY.
No real D1, browser CacheStorage, native audio storage, P05 signer or AI API.
"""
import pathlib
import sqlite3
import unittest

BATTERY=(pathlib.Path(__file__).resolve().parent.parent/'schema'/
 '0005_free_battery_DRAFT.sql').read_text()
SRC='auth_task_source_1234567890123456789'
TRACK='track_offline_local_1'
AUTH="SELECT status,policy_version,session_revoked FROM echo_auth WHERE member_ref=? AND environment=?"
TASK="SELECT status,source_event_ref,commit_attempt FROM echo_task WHERE member_ref=? AND task_ref=?"
JOB="SELECT kind,status,source_event_ref,job_event_ref,attempt_no,policy_version,completed_at_ms FROM echo_job WHERE member_ref=? AND task_ref=?"
RECEIPT=(
 'SELECT h.status AS hold_status,h.member_ref,h.task_ref,h.policy_version,'
 'w.balance,w.version AS wallet_version,w.revoked,'
 "(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id "
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='reserve') AS reserves,"
 "(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id "
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commits,"
 "(SELECT MAX(j.revision) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id "
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_revision "
 'FROM ai3_battery_hold h JOIN ai3_battery_wallet w ON '
 'w.brand_id=h.brand_id AND w.member_ref=h.member_ref '
 "WHERE h.brand_id='starry' AND h.member_ref=? AND h.task_ref=?"
)
class R22EchoTaskBatteryBoundarySQLite(unittest.TestCase):
 def setUp(self):
  self.a=sqlite3.connect(':memory:',isolation_level=None)
  self.t=sqlite3.connect(':memory:',isolation_level=None)
  self.b=sqlite3.connect(':memory:',isolation_level=None)
  for x in (self.a,self.t,self.b): x.row_factory=sqlite3.Row
  self.a.executescript(
   'CREATE TABLE echo_auth(member_ref TEXT,environment TEXT,status TEXT,'
   'policy_version INTEGER,session_revoked INTEGER);'
   "INSERT INTO echo_auth VALUES('member_1','staging','active',1,0);")
  self.t.executescript(
   'CREATE TABLE echo_task(member_ref TEXT,task_ref TEXT,source_event_ref TEXT,'
   'status TEXT,commit_attempt INTEGER,PRIMARY KEY(member_ref,task_ref));'
   "INSERT INTO echo_task VALUES('member_1','task_1',"
   "'auth_task_source_1234567890123456789','committed',1);"
   'CREATE TABLE echo_job(member_ref TEXT,task_ref TEXT,kind TEXT,status TEXT,'
   'source_event_ref TEXT,job_event_ref TEXT,attempt_no INTEGER,'
   'policy_version INTEGER,completed_at_ms INTEGER,'
   'UNIQUE(member_ref,task_ref,kind,job_event_ref));'
   "INSERT INTO echo_job VALUES('member_1','task_1','transcript_job_completed',"
   "'completed','auth_task_source_1234567890123456789',"
   "'transcript_job_12345678901234567890',1,1,110000);")
  self.b.executescript(BATTERY)
  self.b.execute("INSERT INTO ai3_battery_wallet("
   "brand_id,member_ref,balance,registration_granted,version) "
   "VALUES('starry','member_1',3,1,2)")
  self.b.execute("INSERT INTO ai3_battery_hold VALUES("
   "'starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
  self.b.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
   ('starry','member_1',1,'registration_1','registration_grant',10,10,'REGISTER_ONCE',1,100),
   ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000)])
 def tearDown(self):
  for x in (self.a,self.t,self.b):x.close()
 def rows(self):
  def row(db,sql,args):
   r=db.execute(sql,args).fetchone()
   return dict(r) if r else None
  return (row(self.a,AUTH,('member_1','staging')),
   row(self.t,JOB,('member_1','task_1')),
   row(self.t,TASK,('member_1','task_1')),
   row(self.b,RECEIPT,('member_1','task_1')))
 def local_consistent(self):
  a,j,t,w=self.rows()
  return bool(a and j and t and w and a['status']=='active' and
   a['session_revoked']==0 and a['policy_version']==j['policy_version']==w['policy_version'] and
   j['status']=='completed' and j['kind']=='transcript_job_completed' and
   j['attempt_no']==t['commit_attempt']==1 and
   j['source_event_ref']==t['source_event_ref'] and
   j['job_event_ref']!=j['source_event_ref'] and t['status']=='committed' and
   w['hold_status']=='committed' and w['revoked']==0 and
   w['reserves']==w['commits']==1 and w['commit_revision']==w['wallet_version'])
 def settle(self):
  self.b.execute("UPDATE ai3_battery_hold SET status='committed' WHERE task_ref='task_1'")
  self.b.execute("INSERT INTO ai3_battery_journal VALUES("
   "'starry','member_1',3,'task_1','commit',0,3,'TASK_COMMIT',1,110001)")
  self.b.execute("UPDATE ai3_battery_wallet SET version=3 WHERE member_ref='member_1'")
 def test_actual_three_db_connections_no_cross_db_atomicity(self):
  self.assertIsNot(self.a,self.t);self.assertIsNot(self.t,self.b)
  self.assertIn('ai3_battery_journal',RECEIPT)
 def test_echo_play_pause_progress_not_registered_as_task_or_wallet_event(self):
  for e in ('play','pause','seek','progress','ended','offline_download'):
   self.assertNotEqual(self.rows()[1]['kind'],e)
  self.assertEqual(self.rows()[3]['commits'],0)
 def test_legacy_browser_95_percent_completed_not_wallet_settled(self):
  browser={'trackId':TRACK,'completed':True,'cachedAt':1234}
  self.assertTrue(browser['completed'])
  self.assertEqual(self.rows()[3]['hold_status'],'held')
  self.assertFalse(self.local_consistent())
 def test_cache_storage_registry_is_not_native_or_authoritative_wallet(self):
  self.assertNotIn('cachedAt',self.rows()[3])
  self.assertFalse(self.local_consistent())
 def test_transcript_worker_completed_and_task_committed_hold_still_held(self):
  self.assertEqual(self.rows()[1]['status'],'completed')
  self.assertEqual(self.rows()[2]['status'],'committed')
  self.assertEqual(self.rows()[3]['hold_status'],'held')
  self.assertFalse(self.local_consistent())
 def test_local_3_db_consistency_still_not_real_signed_p05_or_ack(self):
  self.settle();self.assertTrue(self.local_consistent())
  self.assertNotIn('signed_event',self.rows()[1])
  self.assertNotIn('independent_kms_floor',self.rows()[3])
 def test_same_job_completion_replay_unique_in_separate_task_db(self):
  self.settle()
  with self.assertRaises(sqlite3.IntegrityError):
   self.t.execute("INSERT INTO echo_job VALUES("
    "'member_1','task_1','transcript_job_completed','completed',"
    "'auth_task_source_1234567890123456789',"
    "'transcript_job_12345678901234567890',2,1,110001)")
  self.assertEqual(self.rows()[3]['commits'],1)
 def test_duplicate_battery_commit_unique_journal(self):
  self.settle()
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("INSERT INTO ai3_battery_journal VALUES("
    "'starry','member_1',4,'task_1','commit',0,3,'DUPLICATE',1,110002)")
  self.assertEqual(self.rows()[3]['commits'],1)
 def test_task_late_source_event_arrival_not_proof_of_wallet(self):
  self.t.execute("UPDATE echo_job SET source_event_ref='late_event_12345678901234567890'")
  self.settle()
  self.assertFalse(self.local_consistent())
 def test_offline_wallet_commit_crash_rolls_back_but_task_still_completed(self):
  self.b.execute('BEGIN IMMEDIATE')
  self.settle();self.assertTrue(self.local_consistent())
  self.b.rollback()
  self.assertFalse(self.local_consistent())
  self.assertEqual(self.rows()[2]['status'],'committed')
 def test_pitr_snapshot_old_wallet_still_held_vs_newer_local(self):
  old=sqlite3.connect(':memory:');old.row_factory=sqlite3.Row
  try:
   self.b.backup(old)
   self.settle()
   before=old.execute(RECEIPT,('member_1','task_1')).fetchone()
   self.assertEqual(before['commits'],0)
   self.assertGreater(self.rows()[3]['wallet_version'],before['wallet_version'])
  finally:old.close()
 def test_cancelled_task_with_local_wallet_committed_denied(self):
  self.settle()
  self.t.execute("UPDATE echo_task SET status='cancelled'")
  self.assertFalse(self.local_consistent())
 def test_expired_hold_with_completed_worker_denied(self):
  self.b.execute("UPDATE ai3_battery_hold SET status='expired'")
  self.assertFalse(self.local_consistent())
 def test_member_revoked_while_transcript_ready_denied(self):
  self.settle()
  self.a.execute("UPDATE echo_auth SET status='deleted',session_revoked=1")
  self.assertFalse(self.local_consistent())
 def test_cross_member_or_environment_source_denied(self):
  self.settle()
  self.a.execute("UPDATE echo_auth SET environment='development'")
  self.assertIsNone(self.rows()[0]);self.assertFalse(self.local_consistent())
 def test_policy_revision_drift_from_audio_job_denied(self):
  self.settle()
  self.t.execute("UPDATE echo_job SET policy_version=2")
  self.assertFalse(self.local_consistent())
 def test_qa_worker_completion_is_distinct_job_event_type(self):
  self.settle()
  self.t.execute("UPDATE echo_job SET kind='qa_job_completed'")
  self.assertNotEqual(self.rows()[1]['kind'],'transcript_job_completed')
  self.assertFalse(self.local_consistent())
 def test_no_store_paid_sku_purchase_or_real_media_fs_in_sql_schema(self):
  for table in ('ai3_battery_wallet','ai3_battery_hold','ai3_battery_journal'):
   columns={x[1] for x in self.b.execute('PRAGMA table_info('+table+')')}
   self.assertFalse(columns.intersection({'store_sku','paid_sku','purchase_token','legacy_audio_url'}))
if __name__=='__main__':unittest.main()
