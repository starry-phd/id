"""R13 single-SQL-statement atomic one-use deletion in *real* SQLite :memory:.
No live D1, legal retention, production OTP, backup cleanup, or H-Global.
"""
import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
UPDATE=('UPDATE starry_deletion_challenges SET consumed_at=? '
 'WHERE challenge_ref=? AND s_user_id=? AND session_id=? '
 'AND auth_version=? AND created_at<=? AND expires_at>? AND consumed_at IS NULL')
class AtomicOneUseDeletion(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for file in ('001_starry_identity.DRAFT.sql',
    '007_starry_age_deletion_admin.UP.DRAFT.sql',
    '011_starry_one_use_deletion.UP.DRAFT.sql'):
   self.db.executescript((ROOT/file).read_text())
  for uid,ver in [('u1',3),('u2',2)]:
   self.db.execute('INSERT INTO starry_members VALUES (?,?,?,?,?,?,?,?,?)',
    (uid,'active',ver,1,'name',1,1,NOW,NOW))
  self.db.executemany('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)',[
   ('s1','u1','app-a','staging',3,'a'*64,NOW+100),
   ('s2','u1','app-b','staging',3,'b'*64,NOW+100),
   ('s3','u2','app-c','staging',2,'c'*64,NOW+100),
  ])
  self.add('a'*64,'u1','s1',3,'event-r13-unique-id-00001')
 def tearDown(self):self.db.close()
 def add(self,reference,uid,sid,version,event):
  self.db.execute('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)',
   (reference,uid,sid,version,event,NOW-5,NOW+60))
 def consume(self,ref='a'*64,uid='u1',sid='s1',version=3,now=NOW):
  return self.db.execute(UPDATE,(now,ref,uid,sid,version,now,now)).rowcount
 def state(self,uid='u1'):
  return self.db.execute('SELECT status,auth_version,display_name FROM starry_members WHERE s_user_id=?',(uid,)).fetchone()
 def test_one_update_atomically_revokes_every_starry_app_and_outboxes(self):
  self.assertEqual(self.consume(),1)
  self.assertEqual(self.state(),('deleted',4,None))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE s_user_id='u1' AND revoked_at IS NULL").fetchone()[0],0)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_outbox WHERE s_user_id='u1'").fetchone()[0],1)
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_deletion_challenges WHERE s_user_id='u1'").fetchone()[0],NOW)
  self.assertEqual(self.state('u2'),('active',2,'name'))
 def test_replay_and_second_concurrent_challenge_do_not_reactivate_or_duplicate(self):
  self.add('b'*64,'u1','s1',3,'event-r13-unique-id-00002')
  self.assertEqual(self.consume(),1)
  self.assertEqual(self.consume(),0)
  with self.assertRaises(sqlite3.IntegrityError):
   self.consume('b'*64)
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_deletion_challenges WHERE challenge_ref=?",('b'*64,)).fetchone()[0],None)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],1)
 def test_one_statement_rollback_on_unique_outbox_collision(self):
  self.db.execute("INSERT INTO starry_deletion_outbox VALUES(?,? ,?,'account_deleted')",
   ('event-r13-unique-id-00001','u2',NOW))
  with self.assertRaises(sqlite3.IntegrityError):self.consume()
  self.assertEqual(self.state(),('active',3,'name'))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE s_user_id='u1' AND revoked_at IS NOT NULL").fetchone()[0],0)
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_deletion_challenges WHERE challenge_ref=?",('a'*64,)).fetchone()[0],None)
 def test_stale_session_revocation_and_member_suspend_block_before_mutation(self):
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE session_id='s1'",(NOW-1,))
  with self.assertRaises(sqlite3.IntegrityError):self.consume()
  self.assertEqual(self.state(),('active',3,'name'))
  self.db.execute("UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='s1'")
  self.db.execute("UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'")
  with self.assertRaises(sqlite3.IntegrityError):self.consume()
  self.assertEqual(self.state(),('suspended',3,'name'))
 def test_wrong_session_version_expired_or_wrong_user_and_early_time(self):
  for kwargs in [{'version':4},{'sid':'s2'},{'uid':'u2'},
    {'now':NOW+61},{'now':NOW-6}]:
   self.assertEqual(self.consume(**kwargs),0)
  self.assertEqual(self.state(),('active',3,'name'))
 def test_atomic_outer_transaction_rollback_includes_challenge_and_events(self):
  self.db.execute('BEGIN IMMEDIATE')
  self.assertEqual(self.consume(),1)
  self.assertEqual(self.state()[0],'deleted')
  self.db.execute('ROLLBACK')
  self.assertEqual(self.state(),('active',3,'name'))
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],0)
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_deletion_challenges").fetchone()[0],None)
 def test_consumed_challenge_cannot_be_reset(self):
  self.assertEqual(self.consume(),1)
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE starry_deletion_challenges SET consumed_at=NULL WHERE challenge_ref=?",('a'*64,))
 def test_repeat_up_and_down_keep_member_session_outbox(self):
  self.db.executescript((ROOT/'011_starry_one_use_deletion.UP.DRAFT.sql').read_text())
  self.assertEqual(self.consume(),1)
  self.db.executescript((ROOT/'011_starry_one_use_deletion.DOWN.DRAFT.sql').read_text())
  self.assertEqual(self.state(),('deleted',4,None))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions").fetchone()[0],3)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_outbox").fetchone()[0],1)
if __name__=='__main__':unittest.main()
