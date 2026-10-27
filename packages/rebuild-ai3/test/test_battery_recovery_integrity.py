"""AI-3 R11: real SQLite :memory: per-record Battery recovery mismatch tests."""
import pathlib,sqlite3,unittest
S=(pathlib.Path(__file__).resolve().parent.parent/'schema'/'0005_free_battery_DRAFT.sql').read_text()
class DeepBatterySnapshots(unittest.TestCase):
 def setUp(self):
  self.c=[sqlite3.connect(':memory:',isolation_level=None) for _ in range(3)]
  for db in self.c:
   db.execute('PRAGMA foreign_keys=ON');db.executescript(S)
   db.execute("INSERT INTO ai3_battery_wallet(brand_id,member_ref,balance,registration_granted,version) VALUES('starry','member_1',3,1,3)")
   db.execute("INSERT INTO ai3_battery_hold VALUES('starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'committed')")
   db.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
    ('starry','member_1',1,'initial_registration','registration_grant',10,10,'REGISTER_ONCE',1,100),
    ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000),
    ('starry','member_1',3,'task_1','commit',0,3,'TASK_SUCCEEDED',1,1100)])
 def tearDown(self):
  for db in self.c:db.close()
 def snapshot(self,db):
  return tuple(tuple(db.execute('SELECT * FROM '+t+' ORDER BY '+columns).fetchall())
   for t,columns in [('ai3_battery_wallet','member_ref'),
    ('ai3_battery_hold','member_ref,task_ref'),('ai3_battery_journal','member_ref,revision')])
 def matches(self):
  return self.snapshot(self.c[0])==self.snapshot(self.c[1])==self.snapshot(self.c[2])
 def test_matching_snapshots_not_proof_of_external_anchor(self):
  self.assertTrue(self.matches())
 def test_same_count_wallet_balance_change(self):
  self.c[1].execute("UPDATE ai3_battery_wallet SET balance=4 WHERE member_ref='member_1'")
  self.assertFalse(self.matches())
  self.assertEqual(self.c[1].execute('SELECT count(*) FROM ai3_battery_wallet').fetchone()[0],1)
 def test_same_count_hold_price_policy_change(self):
  self.c[2].execute("UPDATE ai3_battery_hold SET price=8,policy_version=2 WHERE task_ref='task_1'")
  self.assertFalse(self.matches())
 def test_same_count_journal_tampered_even_if_old_db_trigger_removed(self):
  self.c[1].execute('DROP TRIGGER ai3_battery_journal_no_update')
  self.c[1].execute('UPDATE ai3_battery_journal SET at_ms=1200 WHERE revision=3')
  self.assertEqual(self.c[1].execute('SELECT count(*) FROM ai3_battery_journal').fetchone()[0],3)
  self.assertFalse(self.matches())
 def test_after_account_deletion_pitr_cannot_revive_previous_wallet(self):
  self.c[0].execute("UPDATE ai3_battery_wallet SET balance=0,version=4,revoked=1 WHERE member_ref='member_1'")
  self.c[0].execute("INSERT INTO ai3_battery_journal VALUES ('starry','member_1',4,'deleted_account','revoke',-3,0,'ACCOUNT_DELETED',1,2000)")
  self.assertFalse(self.matches())
 def test_attempt_to_regrant_registration_changes_record(self):
  self.c[1].execute("UPDATE ai3_battery_wallet SET registration_granted=0 WHERE member_ref='member_1'")
  self.assertFalse(self.matches())
 def test_ledger_immutable_and_unique_revision(self):
  with self.assertRaises(sqlite3.IntegrityError):self.c[1].execute('DELETE FROM ai3_battery_journal')
  with self.assertRaises(sqlite3.IntegrityError):
   self.c[1].execute("INSERT INTO ai3_battery_journal VALUES('starry','member_1',3,'fake','commit',0,3,'TASK_SUCCEEDED',1,1200)")
 def test_midway_crash_rollback_matches_unchanged_snapshot(self):
  db=self.c[0];db.execute('BEGIN IMMEDIATE')
  db.execute("UPDATE ai3_battery_wallet SET balance=10 WHERE member_ref='member_1'")
  db.execute("UPDATE ai3_battery_hold SET status='released' WHERE task_ref='task_1'")
  db.rollback()
  self.assertTrue(self.matches())
 def test_missing_hold_detected_even_unchanged_wallet(self):
  self.c[2].execute("DELETE FROM ai3_battery_hold WHERE task_ref='task_1'")
  self.assertFalse(self.matches())
 def test_cross_brand_constraint_enforced(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.c[2].execute("UPDATE ai3_battery_wallet SET brand_id='hglobal' WHERE member_ref='member_1'")
  self.assertTrue(self.matches())
if __name__=='__main__':unittest.main()
