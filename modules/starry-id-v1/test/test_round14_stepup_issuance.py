"""AI-1 R14: genuine SQLite-memory challenge issuance and revocation tests."""
import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'schema'
N=1793000000
INSERT=('INSERT INTO starry_deletion_challenges '
 '(challenge_ref,s_user_id,session_id,auth_version,event_id,created_at,expires_at,consumed_at) '
 'SELECT ?,m.s_user_id,s.session_id,m.auth_version,?,?,?,NULL '
 'FROM starry_members m JOIN starry_sessions s ON s.s_user_id=m.s_user_id '
 "WHERE m.s_user_id=? AND m.status='active' AND m.auth_version=? "
 'AND s.session_id=? AND s.app_id=? AND s.environment=? '
 'AND s.auth_version=m.auth_version AND s.revoked_at IS NULL '
 "AND s.expires_at>? AND s.step_up_method IN ('passkey','totp') "
 'AND s.step_up_verified_at BETWEEN ? AND ? AND s.step_up_expires_at>?')
CONSUME=('UPDATE starry_deletion_challenges SET consumed_at=? '
 'WHERE challenge_ref=? AND s_user_id=? AND session_id=? AND auth_version=? '
 'AND created_at<=? AND expires_at>? AND consumed_at IS NULL')
class IssuanceAndConsumption(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for n in ('001_starry_identity.DRAFT.sql',
    '007_starry_age_deletion_admin.UP.DRAFT.sql',
    '011_starry_one_use_deletion.UP.DRAFT.sql',
    '012_starry_stepup_challenge_scope.UP.DRAFT.sql'):
   self.db.executescript((ROOT/n).read_text())
  self.db.execute("INSERT INTO starry_members VALUES('u1','active',3,1,'Alice',0,0,?,?)",(N,N))
  self.db.execute("INSERT INTO starry_members VALUES('u2','active',3,1,'Bob',0,0,?,?)",(N,N))
  self.db.executemany("""INSERT INTO starry_sessions(
   session_id,s_user_id,app_id,environment,auth_version,refresh_hash,
   expires_at,step_up_method,step_up_verified_at,step_up_expires_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)""",[
    ('sid','u1','app-a','staging',3,'a'*64,N+200,'passkey',N-5,N+120),
    ('other','u1','app-b','staging',3,'b'*64,N+200,None,None,None),
    ('sid2','u2','app-c','staging',3,'c'*64,N+200,'totp',N-5,N+120),
   ])
 def tearDown(self):self.db.close()
 def issue(self,ref='a'*64,event='starry-delete-'+('1'*64),expires=N+90):
  return self.db.execute(INSERT,(ref,event,N,expires,'u1',3,'sid','app-a','staging',
   N,N-300,N,N)).rowcount
 def consume(self,ref='a'*64,now=N):
  return self.db.execute(CONSUME,(now,ref,'u1','sid',3,now,now)).rowcount
 def status(self):
  return self.db.execute("SELECT status,auth_version FROM starry_members WHERE s_user_id='u1'").fetchone()
 def test_actual_issue_and_consume_one_sql_cascade(self):
  self.assertEqual(self.issue(),1)
  s=self.db.execute("SELECT app_id,environment,method,verified_at FROM starry_deletion_challenge_scope").fetchone()
  self.assertEqual(s,('app-a','staging','passkey',N-5))
  self.assertEqual(self.consume(),1)
  self.assertEqual(self.status(),('deleted',4))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE s_user_id='u1' AND revoked_at IS NULL").fetchone()[0],0)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_outbox").fetchone()[0],1)
  self.assertEqual(self.consume(),0)
  self.assertEqual(self.db.execute("SELECT status FROM starry_members WHERE s_user_id='u2'").fetchone()[0],'active')
 def test_two_concurrent_issued_challenges_blocked(self):
  self.issue()
  with self.assertRaises(sqlite3.IntegrityError):
   self.issue('b'*64,'starry-delete-'+('2'*64))
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_challenges').fetchone()[0],1)
 def test_invalid_current_stepup_cannot_insert_even_with_raw_sql(self):
  for action in [
   ("UPDATE starry_sessions SET step_up_method=NULL WHERE session_id='sid'",),
   ("UPDATE starry_sessions SET step_up_expires_at=? WHERE session_id='sid'",(N,)),
   ("UPDATE starry_sessions SET step_up_verified_at=? WHERE session_id='sid'",(N-301,)),
   ("UPDATE starry_sessions SET revoked_at=? WHERE session_id='sid'",(N-1,)),
  ]:
   with self.subTest(action=action):
    self.db.execute(action[0],action[1] if len(action)>1 else ())
    # INSERT...SELECT is fail-closed: absent valid authority => zero rows.
    self.assertEqual(self.issue(),0)
    # A raw INSERT bypassing the SELECT is still rejected by the DB trigger.
    with self.assertRaises(sqlite3.IntegrityError):
     self.db.execute('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)',
      ('a'*64,'u1','sid',3,'starry-delete-'+('1'*64),N,N+90))
    self.db.execute("UPDATE starry_sessions SET step_up_method='passkey',step_up_verified_at=?,step_up_expires_at=?,revoked_at=NULL WHERE session_id='sid'",(N-5,N+120))
 def test_new_stepup_invalidates_old_issued_proof(self):
  self.issue()
  self.db.execute("UPDATE starry_sessions SET step_up_verified_at=? WHERE session_id='sid'",(N,))
  with self.assertRaises(sqlite3.IntegrityError):self.consume()
  self.assertEqual(self.status(),('active',3))
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_deletion_challenges").fetchone()[0],None)
 def test_session_app_scope_tamper_fails_consumption(self):
  self.issue()
  self.db.execute("UPDATE starry_sessions SET app_id='app-z' WHERE session_id='sid'")
  with self.assertRaises(sqlite3.IntegrityError):self.consume()
  self.assertEqual(self.status(),('active',3))
 def test_outbox_collision_rolls_back_challenge_and_sessions(self):
  self.issue()
  self.db.execute("INSERT INTO starry_deletion_outbox VALUES(?,? ,?,'account_deleted')",
   ('starry-delete-'+('1'*64),'u2',N))
  with self.assertRaises(sqlite3.IntegrityError):self.consume()
  self.assertEqual(self.status(),('active',3))
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_deletion_challenges").fetchone()[0],None)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE revoked_at IS NOT NULL").fetchone()[0],0)
 def test_issuance_transaction_rollback_no_authority(self):
  self.db.execute('BEGIN IMMEDIATE')
  self.issue()
  self.db.execute('ROLLBACK')
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_challenges").fetchone()[0],0)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_challenge_scope").fetchone()[0],0)
 def test_scope_migration_down_disposable_preserves_original_identity(self):
  self.issue()
  self.db.executescript((ROOT/'012_starry_stepup_challenge_scope.DOWN.DRAFT.sql').read_text())
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_deletion_challenges").fetchone()[0],1)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_members").fetchone()[0],2)
if __name__=='__main__':unittest.main()
