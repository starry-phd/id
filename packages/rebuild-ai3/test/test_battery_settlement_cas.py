"""R10 Q91/101: exercise SQLite SQL semantics, offline :memory: ONLY."""
import pathlib,sqlite3,unittest
BASE=pathlib.Path(__file__).resolve().parent.parent/'schema'
SCHEMA=(BASE/'0005_free_battery_DRAFT.sql').read_text()+'\n'+(BASE/'0008_battery_settlement_CAS_DRAFT.sql').read_text()
class BatterySettlementCAS(unittest.TestCase):
 def setUp(self):
  self.uri='file:ai3_settlement_'+self._testMethodName+'?mode=memory&cache=shared'
  self.a=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.b=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  for db in (self.a,self.b):db.execute('PRAGMA foreign_keys=ON')
  self.a.executescript(SCHEMA)
  self.a.execute("INSERT INTO ai3_battery_wallet (member_ref,balance,version,registration_granted,overdraft_used) VALUES ('member_1',-2,3,1,1)")
  self.a.execute("INSERT INTO ai3_battery_hold VALUES('starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
 def tearDown(self):self.b.close();self.a.close()
 def run_batch(self,kind='commit',now=180999,version=3,prior=-2,fail_step=0):
  balance=prior+(0 if kind=='commit' else 7)
  status={'commit':'committed','release':'released','expire':'expired'}[kind]
  reason={'commit':'TASK_SUCCEEDED','release':'TASK_FAILED','expire':'TTL_EXPIRED'}[kind]
  self.a.execute('BEGIN IMMEDIATE')
  try:
   sql=("UPDATE ai3_battery_wallet SET balance=?, "
     "overdraft_used=CASE WHEN ?>=0 THEN 0 ELSE overdraft_used END, version=version+1 "
     "WHERE brand_id=? AND member_ref=? AND version=? AND balance=? AND revoked=0 "
     "AND EXISTS(SELECT 1 FROM ai3_battery_hold WHERE brand_id=? AND member_ref=? "
     "AND task_ref=? AND status=? AND price=? AND policy_version=? AND expires_ms=? "
     "AND ((?=? AND expires_ms<=?) OR (?<>? AND expires_ms>?)))")
   params=(balance,balance,'starry','member_1',version,prior,
    'starry','member_1','task_1','held',7,1,181000,kind,'expire',now,kind,'expire',now)
   self.a.execute(sql,params)
   self.a.execute("INSERT INTO ai3_battery_atomic_assert(ok) VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END)")
   if fail_step==1:raise RuntimeError('after-wallet')
   self.a.execute("UPDATE ai3_battery_hold SET status=? "
     "WHERE brand_id=? AND member_ref=? AND task_ref=? AND status=? "
     "AND price=? AND policy_version=? AND expires_ms=? "
     "AND EXISTS(SELECT 1 FROM ai3_battery_wallet WHERE brand_id=? AND member_ref=? "
     "AND version=? AND balance=?)",
     (status,'starry','member_1','task_1','held',7,1,181000,'starry','member_1',version+1,balance))
   self.a.execute("INSERT INTO ai3_battery_atomic_assert(ok) VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END)")
   if fail_step==2:raise RuntimeError('after-hold')
   self.a.execute("INSERT INTO ai3_battery_journal (brand_id,member_ref,revision,event_ref,kind,delta,balance_after,reason_code,policy_version,at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ('starry','member_1',version+1,'task_1',kind,0 if kind=='commit' else 7,balance,reason,1,now))
   self.a.execute("INSERT INTO ai3_battery_atomic_assert(ok) VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END)")
   if fail_step==3:raise RuntimeError('after-journal')
   self.a.execute('DELETE FROM ai3_battery_atomic_assert')
   self.a.commit()
  except Exception:
   self.a.rollback()
   raise
 def row(self):
  return self.b.execute("SELECT balance,version,overdraft_used FROM ai3_battery_wallet WHERE member_ref='member_1'").fetchone()
 def hold(self):
  return self.b.execute("SELECT status FROM ai3_battery_hold WHERE member_ref='member_1' AND task_ref='task_1'").fetchone()[0]
 def journal(self):
  return self.b.execute("SELECT COUNT(*) FROM ai3_battery_journal WHERE member_ref='member_1'").fetchone()[0]
 def test_commit_charges_only_once_and_cleans_scratch(self):
  self.run_batch()
  self.assertEqual(self.row(),(-2,4,1));self.assertEqual(self.hold(),'committed')
  self.assertEqual(self.journal(),1)
  self.assertEqual(self.b.execute('SELECT COUNT(*) FROM ai3_battery_atomic_assert').fetchone()[0],0)
 def test_failure_release_returns_reservation_and_clears_debt(self):
  self.run_batch(kind='release')
  self.assertEqual(self.row(),(5,4,0));self.assertEqual(self.hold(),'released')
  self.assertEqual(self.b.execute('SELECT kind,delta FROM ai3_battery_journal').fetchone(),('release',7))
 def test_expiry_boundary_releases_but_success_cannot_commit(self):
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch(kind='commit',now=181000)
  self.assertEqual(self.row(),(-2,3,1));self.assertEqual(self.hold(),'held')
  self.run_batch(kind='expire',now=181000)
  self.assertEqual(self.row(),(5,4,0));self.assertEqual(self.hold(),'expired')
 def test_before_expiry_cannot_claim_expired(self):
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch(kind='expire',now=180999)
  self.assertEqual(self.row(),(-2,3,1))
 def test_stale_wallet_CAS_rejects_no_partial_update(self):
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch(version=2)
  self.assertEqual(self.row(),(-2,3,1));self.assertEqual(self.hold(),'held');self.assertEqual(self.journal(),0)
 def test_forged_expected_balance_rejects(self):
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch(prior=5)
  self.assertEqual(self.row(),(-2,3,1))
 def test_replayed_settlement_cannot_credit_twice(self):
  self.run_batch(kind='release')
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch(kind='release')
  self.assertEqual(self.row(),(5,4,0));self.assertEqual(self.journal(),1)
 def test_held_price_or_policy_change_never_mutates_wallet(self):
  self.a.execute("UPDATE ai3_battery_hold SET price=8 WHERE task_ref='task_1'")
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch()
  self.assertEqual(self.row(),(-2,3,1));self.assertEqual(self.journal(),0)
 def test_failed_journal_duplicate_rolls_back_wallet_and_hold(self):
  self.a.execute("INSERT INTO ai3_battery_journal VALUES('starry','member_1',4,'task_1','commit',0,-2,'TASK_SUCCEEDED',1,180999)")
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch()
  self.assertEqual(self.row(),(-2,3,1));self.assertEqual(self.hold(),'held');self.assertEqual(self.journal(),1)
 def test_all_intermediate_crashes_rollback_entire_transaction(self):
  for step in (1,2,3):
   with self.assertRaises(RuntimeError):self.run_batch(fail_step=step)
   self.assertEqual(self.row(),(-2,3,1));self.assertEqual(self.hold(),'held');self.assertEqual(self.journal(),0)
   self.assertEqual(self.a.execute('SELECT COUNT(*) FROM ai3_battery_atomic_assert').fetchone()[0],0)
 def test_two_writer_lock_denies_split_commit(self):
  self.a.execute('BEGIN IMMEDIATE')
  try:
   with self.assertRaises(sqlite3.OperationalError):self.b.execute('BEGIN IMMEDIATE')
  finally:self.a.rollback()
  self.run_batch();self.assertEqual(self.row(),(-2,4,1))
 def test_revoked_member_cannot_settle(self):
  self.a.execute("UPDATE ai3_battery_wallet SET revoked=1,balance=0 WHERE member_ref='member_1'")
  with self.assertRaises(sqlite3.IntegrityError):self.run_batch()
  self.assertEqual(self.row(),(0,3,1));self.assertEqual(self.journal(),0)
if __name__=='__main__':unittest.main()
