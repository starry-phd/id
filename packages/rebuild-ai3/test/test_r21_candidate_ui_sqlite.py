"""AI-3 R21 candidate App UI safety — THREE independent disposable SQLite DBs.
Auth and Task are private test-only projection fixtures; Battery is the genuine
historical 0005 schema. No real member, Store, Queue, D1, signed P05 or UI app.
Exercise actual sqlite transactions/rollbacks/replay/PITR while ensuring every
UI interpretation is NON-authoritative, never a claim of charged/completed.
"""
import pathlib
import sqlite3
import unittest

BATTERY_SCHEMA=(pathlib.Path(__file__).resolve().parent.parent/
 'schema'/'0005_free_battery_DRAFT.sql').read_text()
AUTH='SELECT member_ref,environment,status,auth_version,session_revoked,policy_version FROM offline_r21_auth WHERE member_ref=? AND environment=?'
TASK='SELECT task_ref,member_ref,environment,status,source_event_ref,commit_attempt,policy_version FROM offline_r21_task WHERE task_ref=? AND member_ref=? AND environment=?'
WALLET=(
 'SELECT h.task_ref,h.member_ref,h.status AS hold_status,h.policy_version,'
 'h.price,h.created_ms,h.expires_ms,'
 'w.revoked,w.balance,w.version AS wallet_revision,'
 '(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id '
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='reserve') AS reserve_count,"
 '(SELECT COUNT(*) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id '
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_count,"
 '(SELECT MAX(j.revision) FROM ai3_battery_journal j WHERE j.brand_id=h.brand_id '
 "AND j.member_ref=h.member_ref AND j.event_ref=h.task_ref AND j.kind='commit') AS commit_revision "
 'FROM ai3_battery_hold h JOIN ai3_battery_wallet w ON '
 "w.brand_id=h.brand_id AND w.member_ref=h.member_ref WHERE h.brand_id='starry' "
 'AND h.member_ref=? AND h.task_ref=?'
)
class R21CandidateUiThreeSqlite(unittest.TestCase):
 def setUp(self):
  self.a=sqlite3.connect(':memory:',isolation_level=None)
  self.t=sqlite3.connect(':memory:',isolation_level=None)
  self.b=sqlite3.connect(':memory:',isolation_level=None)
  for db in (self.a,self.t,self.b):db.row_factory=sqlite3.Row
  self.a.executescript('CREATE TABLE offline_r21_auth('
   'member_ref TEXT NOT NULL,environment TEXT NOT NULL,status TEXT NOT NULL,'
   'auth_version INTEGER NOT NULL,session_revoked INTEGER NOT NULL,'
   'policy_version INTEGER NOT NULL,PRIMARY KEY(member_ref,environment));'
   "INSERT INTO offline_r21_auth VALUES('member_1','staging','active',3,0,1);")
  self.t.executescript('CREATE TABLE offline_r21_task('
   'task_ref TEXT PRIMARY KEY,member_ref TEXT NOT NULL,'
   'environment TEXT NOT NULL,status TEXT NOT NULL,'
   'source_event_ref TEXT NOT NULL,commit_attempt INTEGER NOT NULL,'
   'policy_version INTEGER NOT NULL);'
   "INSERT INTO offline_r21_task VALUES('task_1','member_1','staging',"
   "'pending','auth_task_source_1234567890123456789',1,1);")
  self.b.executescript(BATTERY_SCHEMA)
  self.b.execute("INSERT INTO ai3_battery_wallet "
   "(brand_id,member_ref,balance,registration_granted,version)"
   " VALUES ('starry','member_1',3,1,2)")
  self.b.execute("INSERT INTO ai3_battery_hold VALUES("
   "'starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
  self.b.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
   ('starry','member_1',1,'registration_1','registration_grant',10,10,'REGISTER_ONCE',1,100),
   ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000)])
 def tearDown(self):
  for db in (self.a,self.t,self.b):db.close()
 def fetch(self,wallet=None):
  ar=self.a.execute(AUTH,('member_1','staging')).fetchone()
  tr=self.t.execute(TASK,('task_1','member_1','staging')).fetchone()
  br=(wallet or self.b).execute(WALLET,('member_1','task_1')).fetchone()
  return (dict(ar) if ar else None,dict(tr) if tr else None,dict(br) if br else None)
 def settle_local(self):
  self.b.execute("UPDATE ai3_battery_hold SET status='committed' "
   "WHERE brand_id='starry' AND member_ref='member_1' AND task_ref='task_1'")
  self.b.execute("INSERT INTO ai3_battery_journal VALUES("
   "'starry','member_1',3,'task_1','commit',0,3,'TASK_COMMIT',1,110001)")
  self.b.execute("UPDATE ai3_battery_wallet SET version=3 WHERE member_ref='member_1'")
 def task_commit(self):
  self.t.execute("UPDATE offline_r21_task SET status='committed' WHERE task_ref='task_1'")
 def state(self,rate=True,legal=True,policy=1,witness=False,wallet=None):
  # Python oracle mirrors the safety priority of the R21 UI *test* projection.
  # The Node tests directly execute the actual TypeScript export with R19 SQL.
  if not legal or policy!=1:return 'blocked'
  if not rate:return 'rate_not_approved'
  a,t,w=self.fetch(wallet)
  if not a or a['status']!='active' or a['session_revoked'] or a['policy_version']!=1:
   return 'blocked'
  if t is None:return 'task_unknown'
  if t['member_ref']!=a['member_ref'] or t['policy_version']!=policy:
   return 'blocked'
  if not w:return 'receipt_mismatch' if t['status']=='committed' else 'balance_unverified'
  if w['revoked'] or w['member_ref']!=a['member_ref'] or w['policy_version']!=policy:
   return 'blocked'
  if t['status']=='pending':
   return 'hold_pending' if w['hold_status']=='held' else 'task_unknown'
  if t['status']=='cancelled':
   return 'task_failed' if w['hold_status'] in ('released','revoked','expired') else 'receipt_mismatch'
  if t['status']=='committed':
   if w['hold_status']!='committed' or w['reserve_count']!=1 or w['commit_count']!=1 or w['commit_revision']!=w['wallet_revision']:
    return 'receipt_mismatch'
   # Witness boolean means test-only not signed/anti-rollback KMS proof.
   return 'review_only' if witness else 'receipt_mismatch'
  return 'blocked'
 def test_actual_three_separate_sqlite_connections(self):
  self.assertIsNot(self.a,self.t);self.assertIsNot(self.t,self.b)
  self.assertIn('ai3_battery_journal',WALLET)
 def test_pending_held_is_never_completed(self):
  self.assertEqual(self.state(),'hold_pending')
 def test_double_click_reserve_does_not_duplicate_task(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("INSERT INTO ai3_battery_hold VALUES("
    "'starry','member_1','task_1','starry-ai','chat',7,1,1,1001,181001,'held')")
  self.assertEqual(self.state(),'hold_pending')
 def test_task_committed_wallet_still_pending_is_mismatch(self):
  self.task_commit()
  self.assertEqual(self.state(),'receipt_mismatch')
  self.assertEqual(self.fetch()[2]['commit_count'],0)
 def test_partial_commit_auth_task_survive_battery_crash(self):
  self.task_commit();self.b.execute('BEGIN IMMEDIATE')
  self.settle_local()
  self.assertEqual(self.state(witness=True),'review_only')
  self.b.rollback()
  self.assertEqual(self.state(),'receipt_mismatch')
 def test_consistent_local_receipt_not_approved_signed_source(self):
  self.task_commit();self.settle_local()
  self.assertEqual(self.state(witness=False),'receipt_mismatch')
  self.assertEqual(self.state(witness=True),'review_only') # never 'completed'
 def test_source_authority_deletion_race_blocks_old_task_status(self):
  self.task_commit();self.settle_local()
  self.a.execute("UPDATE offline_r21_auth SET status='deleted',session_revoked=1,auth_version=4")
  self.assertEqual(self.state(),'blocked')
 def test_foreign_member_task_lookup_is_unknown_not_private_data(self):
  self.t.execute("UPDATE offline_r21_task SET member_ref='other_member'")
  self.assertIsNone(self.fetch()[1])
  self.assertEqual(self.state(),'task_unknown')
 def test_cross_environment_not_exposed_as_valid_task(self):
  self.t.execute("UPDATE offline_r21_task SET environment='development'")
  self.assertEqual(self.state(),'task_unknown')
 def test_policy_rotation_blocks_even_with_local_matching_receipt(self):
  self.task_commit();self.settle_local()
  self.a.execute('UPDATE offline_r21_auth SET policy_version=2')
  self.assertEqual(self.state(),'blocked')
  self.assertEqual(self.state(policy=2),'blocked')
 def test_unapproved_free_rate_blocks_before_wallet_reads(self):
  self.assertEqual(self.state(rate=False),'rate_not_approved')
 def test_unlawful_retention_cannot_claim_pending_or_balance(self):
  self.assertEqual(self.state(legal=False),'blocked')
 def test_old_pitr_wallet_snapshot_is_not_same_committed_receipt(self):
  old=sqlite3.connect(':memory:');old.row_factory=sqlite3.Row
  try:
   self.b.backup(old)
   self.task_commit();self.settle_local()
   self.assertEqual(self.state(witness=True),'review_only')
   self.assertEqual(self.state(witness=True,wallet=old),'receipt_mismatch')
   self.assertLess(self.fetch(old)[2]['wallet_revision'],self.fetch()[2]['wallet_revision'])
  finally:old.close()
 def test_duplicate_local_commit_journal_denied_by_original_unique(self):
  self.task_commit();self.settle_local()
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("INSERT INTO ai3_battery_journal VALUES("
    "'starry','member_1',4,'task_1','commit',0,3,'DUPLICATE',1,110002)")
 def test_missing_receipt_cannot_confirm_balance(self):
  self.b.execute("DELETE FROM ai3_battery_hold WHERE task_ref='task_1'")
  self.assertEqual(self.state(),'balance_unverified')
 def test_cancelled_task_with_released_hold_is_failed_not_final_settlement(self):
  self.t.execute("UPDATE offline_r21_task SET status='cancelled'")
  self.b.execute("UPDATE ai3_battery_hold SET status='released' WHERE task_ref='task_1'")
  self.assertEqual(self.state(),'task_failed')
 def test_revoked_wallet_never_renders_spendable_balance(self):
  self.b.execute("UPDATE ai3_battery_wallet SET revoked=1,balance=0")
  self.assertEqual(self.state(),'blocked')
 def test_no_store_sku_payment_or_purchase_mode_in_battery_schema(self):
  cols={x[1] for x in self.b.execute('PRAGMA table_info(ai3_battery_wallet)')}
  self.assertFalse({'store_sku','iap_receipt','purchase_id'} & cols)
  self.assertEqual(self.state(),'hold_pending')
if __name__=='__main__':unittest.main()
