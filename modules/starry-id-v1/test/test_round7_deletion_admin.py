"""AI-1 Q88/Q97/Q98/Q122 in-memory SQLite atomic deletion / sole supreme Gate."""
from pathlib import Path
import sqlite3, unittest
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
class DeletionAndAdminGate(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for n in ('001_starry_identity.DRAFT.sql','007_starry_age_deletion_admin.UP.DRAFT.sql'):
   self.db.executescript((ROOT/n).read_text())
  self.db.executemany('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)',[
   ('s1','active',3,1,'Alice',1,1,NOW-100,NOW-100),
   ('s2','active',1,1,'Bob',0,0,NOW-100,NOW-100)])
  self.db.execute("INSERT INTO starry_identities VALUES('apple','subject1','s1')")
  self.db.executemany('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)',[
   ('a','s1','id','staging',3,'a'*64,NOW+1000),
   ('b','s1','another-starry-app','staging',3,'b'*64,NOW+1000)])
 def tearDown(self):self.db.close()
 def deletion(self,event='event-unique-000000000001',throw=False):
  self.db.execute('BEGIN IMMEDIATE')
  try:
   c=self.db.execute("UPDATE starry_members SET status='deleted',auth_version=?,display_name=NULL,directory_opt_in=0,display_name_public=0,profile_revision=?,updated_at=? WHERE s_user_id=? AND status='active' AND auth_version=? AND profile_revision=?",
    (4,2,NOW,'s1',3,1)).rowcount
   self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id=? AND revoked_at IS NULL",(NOW,'s1'))
   e=self.db.execute("INSERT INTO starry_deletion_outbox(event_id,s_user_id,occurred_at,event_type) SELECT ?,s_user_id,?,'account_deleted' FROM starry_members WHERE s_user_id=? AND status='deleted' AND auth_version=? AND updated_at=? AND NOT EXISTS(SELECT 1 FROM starry_deletion_outbox WHERE s_user_id=?)",
    (event,NOW,'s1',4,NOW,'s1')).rowcount
   if throw:raise RuntimeError('simulated transaction failure')
   self.db.execute('COMMIT')
   return c,e
  except:
   self.db.execute('ROLLBACK');raise
 def test_deletion_revokes_all_starry_apps_and_idempotent(self):
  self.assertEqual(self.deletion(),(1,1))
  self.assertEqual(self.db.execute("SELECT status,auth_version,display_name,directory_opt_in FROM starry_members WHERE s_user_id='s1'").fetchone(),('deleted',4,None,0))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE s_user_id='s1' AND revoked_at IS NULL").fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],1)
  self.assertEqual(self.deletion('event-unique-000000000002'),(0,0))
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],1)
 def test_deleted_member_cannot_reactivate_even_after_attempted_restore(self):
  self.deletion()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE starry_members SET status='active' WHERE s_user_id='s1'")
  self.assertEqual(self.db.execute("SELECT status FROM starry_members WHERE s_user_id='s1'").fetchone()[0],'deleted')
  self.assertEqual(self.db.execute("SELECT status FROM starry_members WHERE s_user_id='s2'").fetchone()[0],'active')
 def test_failed_transaction_leaves_all_sessions_and_member_intact(self):
  with self.assertRaises(RuntimeError):self.deletion(throw=True)
  self.assertEqual(self.db.execute("SELECT auth_version,status FROM starry_members WHERE s_user_id='s1'").fetchone(),(3,'active'))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE s_user_id='s1' AND revoked_at IS NULL").fetchone()[0],2)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],0)
 def test_protected_single_supreme_per_environment_and_admin_revocation(self):
  self.db.execute("INSERT INTO starry_admin_roles VALUES('s1','staging','supreme',NULL)")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO starry_admin_roles VALUES('s2','staging','supreme',NULL)")
  self.db.execute("INSERT INTO starry_admin_roles VALUES('s2','staging','delegated',NULL)")
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_admin_roles WHERE role='supreme' AND revoked_at IS NULL").fetchone()[0],1)
  self.db.execute("UPDATE starry_admin_roles SET revoked_at=? WHERE s_user_id='s1'",(NOW,))
  self.db.execute("UPDATE starry_admin_roles SET role='supreme' WHERE s_user_id='s2'")
  self.assertEqual(self.db.execute("SELECT s_user_id FROM starry_admin_roles WHERE role='supreme' AND revoked_at IS NULL").fetchone()[0],'s2')
 def test_rollback_migration_preserves_member_and_session_tables(self):
  self.db.executescript((ROOT/'007_starry_age_deletion_admin.DOWN.DRAFT.sql').read_text())
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_members').fetchone()[0],2)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_sessions').fetchone()[0],2)
  with self.assertRaises(sqlite3.OperationalError):
   self.db.execute('SELECT 1 FROM starry_deletion_outbox')
 def test_cross_brand_foreign_keys_do_not_touch_hglobal(self):
  self.assertTrue(all('hglobal' not in x[0] for x in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")))
  self.deletion()
  self.assertEqual(self.db.execute("SELECT s_user_id FROM starry_members WHERE s_user_id='s2'").fetchone()[0],'s2')
if __name__=='__main__':unittest.main()
