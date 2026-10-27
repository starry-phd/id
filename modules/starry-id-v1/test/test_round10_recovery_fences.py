"""R10: real isolated SQLite transactions, three anti-resurrection fences."""
import unittest, sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
class RecoveryAuthFences(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for f in ('001_starry_identity.DRAFT.sql',
            '007_starry_age_deletion_admin.UP.DRAFT.sql',
            '008_starry_first_gift_privacy.UP.DRAFT.sql'):
   self.db.executescript((ROOT/f).read_text())
  self.db.execute("INSERT INTO starry_members VALUES ('u1','active',3,1,NULL,0,0,?,?)",(NOW,NOW))
  self.db.execute("INSERT INTO starry_members VALUES ('u2','active',1,1,NULL,0,0,?,?)",(NOW,NOW))
  self.db.executemany("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)",[
   ('s1','u1','starry-a','staging',3,'a'*64,NOW+100),
   ('s2','u1','starry-b','staging',3,'b'*64,NOW+100)])
  self.up()
 def tearDown(self):self.db.close()
 def up(self):self.db.executescript((ROOT/'010_starry_recovery_auth_fences.UP.DRAFT.sql').read_text())
 def fences(self):
  return self.db.execute("SELECT deleted_members,revoked_sessions,claimed_registration_gifts FROM starry_auth_recovery_fence WHERE realm='starry'").fetchone()
 def test_exact_one_for_each_real_committed_auth_event(self):
  self.assertEqual(self.fences(),(0,0,0))
  self.db.execute("UPDATE starry_members SET status='deleted',auth_version=4 WHERE s_user_id='u1'")
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id='u1'",(NOW,))
  self.db.execute("INSERT INTO starry_first_gift_claims VALUES(?,?,?)",('a'*64,1,NOW))
  self.assertEqual(self.fences(),(1,2,1))
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id='u1'",(NOW,))
  self.assertEqual(self.fences(),(1,2,1))
 def test_atomic_failed_transaction_does_not_increment_fences(self):
  self.db.execute('BEGIN IMMEDIATE')
  self.db.execute("UPDATE starry_members SET status='suspended',auth_version=4 WHERE s_user_id='u1'")
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id='u1'",(NOW,))
  self.db.execute("INSERT INTO starry_first_gift_claims VALUES(?,?,?)",('a'*64,1,NOW))
  self.assertEqual(self.fences(),(0,2,1))
  self.db.execute('ROLLBACK')
  self.assertEqual(self.fences(),(0,0,0))
  self.assertEqual(self.db.execute("SELECT status FROM starry_members WHERE s_user_id='u1'").fetchone()[0],'active')
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_first_gift_claims").fetchone()[0],0)
 def test_no_counter_rewind_or_manual_delete(self):
  self.db.execute("UPDATE starry_members SET status='deleted' WHERE s_user_id='u2'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE starry_auth_recovery_fence SET deleted_members=0")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("DELETE FROM starry_auth_recovery_fence")
  self.assertEqual(self.fences(),(1,0,0))
 def test_schema_idempotent_and_down_preserves_members_and_gifts(self):
  self.up();self.db.execute("INSERT INTO starry_first_gift_claims VALUES(?,?,?)",('b'*64,1,NOW))
  self.assertEqual(self.fences(),(0,0,1))
  self.up();self.assertEqual(self.fences(),(0,0,1))
  self.db.executescript((ROOT/'010_starry_recovery_auth_fences.DOWN.DRAFT.sql').read_text())
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_members').fetchone()[0],2)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_first_gift_claims').fetchone()[0],1)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='starry_auth_recovery_fence'").fetchone()[0],0)
 def test_initial_count_seed_for_existing_events(self):
  self.db.executescript((ROOT/'010_starry_recovery_auth_fences.DOWN.DRAFT.sql').read_text())
  self.db.execute("UPDATE starry_members SET status='deleted' WHERE s_user_id='u2'")
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE session_id='s1'",(NOW,))
  self.db.execute("INSERT INTO starry_first_gift_claims VALUES(?,?,?)",('c'*64,1,NOW))
  self.up();self.assertEqual(self.fences(),(1,1,1))
 def test_snapshot_rollback_warning_fence_alone_not_external_authority(self):
  # It is possible to restore the entire DB to a prior instant: the counters
  # themselves roll back. Independent signed/append-only authority is essential.
  self.db.execute('BEGIN IMMEDIATE')
  self.db.execute("UPDATE starry_members SET status='deleted' WHERE s_user_id='u2'")
  self.assertEqual(self.fences(),(1,0,0))
  self.db.execute('ROLLBACK')
  self.assertEqual(self.fences(),(0,0,0))
if __name__=='__main__':unittest.main()
