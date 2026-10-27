"""R14: Starry Auth deletion outbox -> Battery one-statement SQLite CAS, offline only."""
import pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent/'schema'
BASE=(ROOT/'0005_free_battery_DRAFT.sql').read_text()
DELETE=(ROOT/'0010_auth_delete_battery_inbox_DRAFT.sql').read_text()
EVENT='delete_event_12345678901234567890'
SQL=("INSERT INTO ai3_r14_deletion_inbox "
 "(brand_id,environment,event_id,member_ref,event_type,occurred_at_ms,policy_version,applied) "
 "VALUES (?,?,?,?,?,?,?,0)")
class BatteryDeletion(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None,timeout=0)
  self.db.execute('PRAGMA foreign_keys=ON')
  self.db.executescript(BASE+DELETE)
  self.db.execute("INSERT INTO ai3_battery_wallet"
   "(brand_id,member_ref,balance,registration_granted,version)"
   " VALUES('starry','member_1',3,1,2)")
  self.db.execute("INSERT INTO ai3_battery_hold VALUES"
   "('starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
  self.db.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
   ('starry','member_1',1,'initial_registration','registration_grant',10,10,'REGISTER_ONCE',1,100),
   ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000)])
 def tearDown(self):self.db.close()
 def apply(self,ref=EVENT,member='member_1',environment='staging'):
  self.db.execute(SQL,('starry',environment,ref,member,'account_deleted',5000,1))
 def wallet(self):
  return self.db.execute("SELECT balance,revoked,version,overdraft_used "
   "FROM ai3_battery_wallet WHERE member_ref='member_1'").fetchone()
 def journal_count(self):
  return self.db.execute("SELECT COUNT(*) FROM ai3_battery_journal WHERE member_ref='member_1'").fetchone()[0]
 def inbox(self):
  return self.db.execute("SELECT event_id,applied FROM ai3_r14_deletion_inbox").fetchall()
 def hold(self):
  return self.db.execute("SELECT status FROM ai3_battery_hold WHERE task_ref='task_1'").fetchone()[0]
 def test_atomic_deletion_revokes_wallet_holds_and_appends_journal(self):
  self.apply()
  self.assertEqual(self.wallet(),(0,1,3,0))
  self.assertEqual(self.hold(),'revoked')
  self.assertEqual(self.inbox(),[(EVENT,1)])
  self.assertEqual(self.db.execute("SELECT revision,event_ref,kind,delta,balance_after "
   "FROM ai3_battery_journal WHERE revision=3").fetchone(),(3,EVENT,'revoke',-3,0))
 def test_replayed_identical_outbox_event_makes_no_second_mutation(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):self.apply()
  self.assertEqual(self.wallet(),(0,1,3,0))
  self.assertEqual(self.journal_count(),3)
  self.assertEqual(len(self.inbox()),1)
 def test_different_event_id_same_member_denied_to_prevent_second_revoke(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):self.apply('delete_event_12345678901234567891')
  self.assertEqual(len(self.inbox()),1);self.assertEqual(self.journal_count(),3)
 def test_journal_revision_collision_rolls_back_entire_insert(self):
  self.db.execute("INSERT INTO ai3_battery_journal VALUES"
   "('starry','member_1',3,'previous_conflict','admin_correction',0,3,'ADMIN_REVIEW',1,1200)")
  with self.assertRaises(sqlite3.IntegrityError):self.apply()
  self.assertEqual(self.wallet(),(3,0,2,0))
  self.assertEqual(self.hold(),'held')
  self.assertEqual(self.inbox(),[])
  self.assertEqual(self.journal_count(),3)
 def test_future_session_success_cannot_revive_deleted_wallet(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE ai3_battery_wallet SET revoked=0,balance=10 WHERE member_ref='member_1'")
  self.assertEqual(self.wallet(),(0,1,3,0))
 def test_held_task_cannot_settle_after_wallet_revocation(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE ai3_battery_wallet SET version=version+1 WHERE member_ref='member_1'")
  self.assertEqual(self.hold(),'revoked')
 def test_spent_inbox_row_cannot_be_updated_or_deleted(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE ai3_r14_deletion_inbox SET applied=0 WHERE event_id=?",(EVENT,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("DELETE FROM ai3_r14_deletion_inbox WHERE event_id=?",(EVENT,))
  self.assertEqual(self.inbox(),[(EVENT,1)])
 def test_refuse_hglobal_environment_and_missing_wallet(self):
  for args in [('hglobal','staging',EVENT,'member_1'),
   ('starry','production',EVENT,'member_1'),
   ('starry','staging',EVENT,'ghost')]:
   with self.assertRaises(sqlite3.IntegrityError):
    self.db.execute(SQL,(args[0],args[1],args[2],args[3],'account_deleted',5000,1))
  self.assertEqual(self.inbox(),[]);self.assertEqual(self.wallet(),(3,0,2,0))
 def test_pre_revoked_wallet_and_outbox_failed_insert_do_not_write(self):
  self.db.execute("UPDATE ai3_battery_wallet SET revoked=1,balance=0 WHERE member_ref='member_1'")
  with self.assertRaises(sqlite3.IntegrityError):self.apply()
  self.assertEqual(self.inbox(),[])
  self.assertEqual(self.journal_count(),2)
 def test_outer_rollback_undoes_all_trigger_writes_and_inbox(self):
  self.db.execute('BEGIN IMMEDIATE')
  self.apply()
  self.assertEqual(self.hold(),'revoked')
  self.db.rollback()
  self.assertEqual(self.wallet(),(3,0,2,0))
  self.assertEqual(self.hold(),'held')
  self.assertEqual(self.inbox(),[])
  self.assertEqual(self.journal_count(),2)
 def test_all_paid_billing_and_hglobal_never_touched_by_starrry(self):
  self.assertEqual(self.db.execute("SELECT name FROM sqlite_master WHERE name LIKE '%billing%' OR name LIKE '%hglobal%'").fetchall(),[])
  self.apply()
  self.assertEqual(self.wallet(),(0,1,3,0))
 def test_deleted_member_journal_cannot_append_any_fake_grant(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO ai3_battery_journal VALUES"
    "('starry','member_1',4,'forged_grant','first_task_grant',50,50,'FIRST_TASK_PAID',1,6000)")
  self.assertEqual(self.journal_count(),3)
 def test_deleted_member_cannot_create_or_restage_hold(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO ai3_battery_hold VALUES"
    "('starry','member_1','task_2','starry-ai','chat',7,1,1,2000,182000,'held')")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE ai3_battery_hold SET status='held' WHERE task_ref='task_1'")
  self.assertEqual(self.hold(),'revoked')
 def test_deleted_member_registry_survives_battery_revoke_with_no_regrant(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE ai3_battery_wallet SET registration_granted=0 WHERE member_ref='member_1'")
  self.assertEqual(self.db.execute("SELECT registration_granted FROM ai3_battery_wallet").fetchone()[0],1)
if __name__=='__main__':unittest.main()
