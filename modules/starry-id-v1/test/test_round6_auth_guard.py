"""AI-1 R6: real in-memory SQLite migration + Session/identity/replay guard.
This is NOT Cloudflare D1 real concurrency or remote migration evidence.
"""
from pathlib import Path
import sqlite3,unittest
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
SESSION_QUERY=(
 "SELECT 1 AS allowed FROM starry_sessions s JOIN starry_members m ON m.s_user_id=s.s_user_id "
 "JOIN starry_identities i ON i.s_user_id=m.s_user_id "
 "WHERE s.session_id=? AND s.s_user_id=? AND s.app_id=? AND s.environment=? "
 "AND s.auth_version=? AND s.expires_at>? AND s.revoked_at IS NULL "
 "AND m.status='active' AND m.auth_version=s.auth_version "
 "AND i.provider=? AND i.subject=? LIMIT 1"
)
STATE_CAS=("UPDATE starry_oauth_attempts SET consumed_at=? WHERE state=? AND provider=? "
 "AND app_id=? AND environment=? AND client_id=? AND consumed_at IS NULL AND expires_at>?")
class SessionAuthorityRound6SQLite(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for name in ['001_starry_identity.DRAFT.sql','003_starry_oauth_round3.DRAFT.sql',
               '005_starry_oidc_indexes.UP.DRAFT.sql']:
   self.db.executescript((ROOT/name).read_text())
  self.db.execute('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)',
   ('s1','active',3,1,None,0,0,NOW-100,NOW-100))
  self.db.execute('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)',
   ('s2','suspended',2,1,None,0,0,NOW-100,NOW-100))
  self.db.executemany('INSERT INTO starry_identities VALUES(?,?,?)',
    [('apple','apple-sub','s1'),('google','google-sub','s2')])
  self.db.execute('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)',
   ('session1','s1','starry-id','staging',3,'a'*64,NOW+3600))
  self.db.execute('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)',
   ('session2','s2','starry-id','staging',2,'b'*64,NOW+3600))
  self.state='S'*40
  self.db.execute('INSERT INTO starry_oauth_attempts VALUES(?,?,?,?,?,?,?,?,?,?)',
   (self.state,'apple','starry-id','staging','phd.starry.id','C'*43,'N'*32,NOW+60,None,NOW-100))
 def tearDown(self):self.db.close()
 def run_sql(self,name):self.db.executescript((ROOT/name).read_text())
 def session(self,sid='session1',user='s1',app='starry-id',env='staging',version=3,
             now=NOW,provider='apple',subject='apple-sub'):
  return self.db.execute(SESSION_QUERY,(sid,user,app,env,version,now,provider,subject)).fetchone()
 def test_safe_reversible_idempotent_forward_backward_and_member_preserved(self):
  up='006_starry_auth_guard.UP.DRAFT.sql';down='006_starry_auth_guard.DOWN.DRAFT.sql'
  for _ in range(2):self.run_sql(up)
  indexes={r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
  for idx in ['idx_starry_r6_identity_owner','idx_starry_r6_session_current','idx_starry_r6_oauth_pending_expiry']:
   self.assertIn(idx,indexes)
  for _ in range(2):self.run_sql(down)
  indexes={r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
  self.assertNotIn('idx_starry_r6_session_current',indexes)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_members').fetchone()[0],2)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_sessions').fetchone()[0],2)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_identities').fetchone()[0],2)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_oauth_attempts').fetchone()[0],1)
 def test_session_active_provider_subject_and_scoped_app_env(self):
  self.run_sql('006_starry_auth_guard.UP.DRAFT.sql')
  self.assertEqual(self.session(),(1,))
  self.assertIsNone(self.session(app='hglobal-id'))
  self.assertIsNone(self.session(env='production'))
  self.assertIsNone(self.session(provider='google'))
  self.assertIsNone(self.session(subject='forged-sub'))
  self.assertIsNone(self.session(user='s2',sid='session2',version=2,provider='google',subject='google-sub'))
 def test_suspended_revoked_expired_and_auth_version_bump_fail_closed(self):
  self.run_sql('006_starry_auth_guard.UP.DRAFT.sql')
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE session_id='session1'",(NOW,))
  self.assertIsNone(self.session())
  self.db.execute("UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='session1'")
  self.assertIsNone(self.session(now=NOW+3600))
  self.assertIsNone(self.session(version=2))
  self.db.execute("UPDATE starry_members SET auth_version=auth_version+1 WHERE s_user_id='s1'")
  self.assertIsNone(self.session())
  self.db.execute("UPDATE starry_members SET auth_version=3,status='suspended' WHERE s_user_id='s1'")
  self.assertIsNone(self.session())
  self.db.execute("UPDATE starry_members SET status='deleted' WHERE s_user_id='s1'")
  self.assertIsNone(self.session())
 def test_oauth_single_consume_and_wrong_brand_app_env_client_provider_or_expiry(self):
  self.run_sql('006_starry_auth_guard.UP.DRAFT.sql')
  def cas(app='starry-id',env='staging',client='phd.starry.id',provider='apple',now=NOW):
   return self.db.execute(STATE_CAS,(now,self.state,provider,app,env,client,now)).rowcount
  self.assertEqual(cas(app='hglobal-id'),0)
  self.assertEqual(cas(env='production'),0)
  self.assertEqual(cas(provider='google'),0)
  self.assertEqual(cas(client='attacker.client'),0)
  self.assertEqual(cas(now=NOW+60),0)
  self.assertEqual(cas(),1)
  self.assertEqual(cas(),0)
  self.assertEqual(self.db.execute('SELECT consumed_at FROM starry_oauth_attempts').fetchone()[0],NOW)
 def test_oauth_cas_rollback_on_failed_transaction(self):
  self.run_sql('006_starry_auth_guard.UP.DRAFT.sql')
  self.db.execute('BEGIN IMMEDIATE')
  self.assertEqual(self.db.execute(STATE_CAS,(NOW,self.state,'apple','starry-id','staging','phd.starry.id',NOW)).rowcount,1)
  self.db.execute('ROLLBACK')
  self.assertEqual(self.db.execute('SELECT consumed_at FROM starry_oauth_attempts').fetchone()[0],None)
  self.assertEqual(self.db.execute(STATE_CAS,(NOW,self.state,'apple','starry-id','staging','phd.starry.id',NOW)).rowcount,1)
if __name__=='__main__':unittest.main()
