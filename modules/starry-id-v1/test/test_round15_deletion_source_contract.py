"""R15: REAL SQLite :memory: immutable committed Auth deletion source.
No live D1, Queue, Billing identity/HMAC migration, Store or H-Global.
"""
import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
EVENT='starry-delete-'+'a'*64
QUERY=(
 'SELECT o.event_id,o.s_user_id,o.occurred_at,o.event_type,'
 'm.auth_version,m.status AS member_status,m.updated_at AS member_updated_at,'
 'm.display_name AS profile_name,m.directory_opt_in,m.display_name_public,'
 '(SELECT COUNT(*) FROM starry_sessions s WHERE s.s_user_id=m.s_user_id '
 'AND s.revoked_at IS NULL) AS pending_sessions '
 'FROM starry_deletion_outbox o JOIN starry_members m ON m.s_user_id=o.s_user_id '
 "WHERE o.event_id=? AND o.event_type='account_deleted' LIMIT 1"
)
class DeletionSource(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for f in ('001_starry_identity.DRAFT.sql','007_starry_age_deletion_admin.UP.DRAFT.sql',
   '011_starry_one_use_deletion.UP.DRAFT.sql',
   '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
   '013_starry_deletion_source_immutability.UP.DRAFT.sql'):
   self.db.executescript((ROOT/f).read_text())
  self.db.execute("INSERT INTO starry_members VALUES('u1','active',3,1,'profile',1,1,?,?)",(NOW,NOW))
  self.db.executemany("""INSERT INTO starry_sessions(
   session_id,s_user_id,app_id,environment,auth_version,refresh_hash,
   expires_at,step_up_method,step_up_verified_at,step_up_expires_at)
   VALUES(?,?,?,?,?,?,?,?,?,?)""",[
   ('s1','u1','app-a','staging',3,'a'*64,NOW+200,'passkey',NOW-5,NOW+100),
   ('s2','u1','app-b','staging',3,'b'*64,NOW+200,None,None,None),
  ])
 def tearDown(self):self.db.close()
 def challenge(self):
  self.db.execute('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)',
   ('a'*64,'u1','s1',3,EVENT,NOW,NOW+90))
 def consume(self):
  return self.db.execute("UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL",
   (NOW,'a'*64)).rowcount
 def select(self):
  return self.db.execute(QUERY,(EVENT,)).fetchone()
 def test_atomic_deletion_produces_readable_auth_source_with_all_sessions_revoked(self):
  self.challenge();self.assertEqual(self.consume(),1)
  row=self.select()
  self.assertEqual(row,(EVENT,'u1',NOW,'account_deleted',4,'deleted',NOW,None,0,0,0))
 def test_source_outbox_update_delete_forbidden_even_for_direct_raw_sql(self):
  self.challenge();self.consume()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE starry_deletion_outbox SET occurred_at=? WHERE event_id=?",(NOW+1,EVENT))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("DELETE FROM starry_deletion_outbox WHERE event_id=?",(EVENT,))
  self.assertIsNotNone(self.select())
 def test_forged_insert_during_live_member_denied_before_change(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO starry_deletion_outbox VALUES (?,?,?,'account_deleted')",(EVENT,'u1',NOW))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_outbox").fetchone()[0],0)
 def test_same_db_transaction_rollback_removes_event_and_member_delete(self):
  self.challenge();self.db.execute('BEGIN IMMEDIATE')
  self.consume()
  self.assertIsNotNone(self.select())
  self.db.execute('ROLLBACK')
  self.assertIsNone(self.select())
  self.assertEqual(self.db.execute("SELECT status FROM starry_members WHERE s_user_id='u1'").fetchone()[0],'active')
 def test_failed_outbox_insert_collision_rolls_back_entire_challenge(self):
  self.challenge()
  self.db.execute("UPDATE starry_members SET status='deleted',display_name=NULL,directory_opt_in=0,display_name_public=0 WHERE s_user_id='u1'")
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id='u1'",(NOW,))
  self.db.execute("INSERT INTO starry_deletion_outbox VALUES(?,?,?,'account_deleted')",(EVENT,'u1',NOW))
  # Already deleted member means the R13 guard aborts, cannot consume proof.
  with self.assertRaises(sqlite3.IntegrityError):self.consume()
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_deletion_challenges").fetchone()[0],None)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_outbox").fetchone()[0],1)
 def test_down_preserves_exact_original_outbox_schema_and_data(self):
  self.challenge();self.consume()
  self.db.executescript((ROOT/'013_starry_deletion_source_immutability.DOWN.DRAFT.sql').read_text())
  self.assertEqual([x[1] for x in self.db.execute('PRAGMA table_info(starry_deletion_outbox)')],
   ['event_id','s_user_id','occurred_at','event_type'])
  self.assertIsNotNone(self.select())
if __name__=='__main__':unittest.main()
