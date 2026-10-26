import pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent
S=(ROOT/'schema/001_starry_identity.DRAFT.sql').read_text()
NOW=1793000000
class Round4SessionSQLite(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  self.db.executescript(S)
  for user,status,version in [('s1','active',2),('s2','suspended',3)]:
   self.db.execute('INSERT INTO starry_members VALUES (?,?,?,?,?,?,?,?,?)',
     (user,status,version,1,None,0,0,1,1))
  self.db.executemany('INSERT INTO starry_identities VALUES (?,?,?)',
   [('apple','apple-1','s1'),('google','google-2','s2')])
  self.new="INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) SELECT ?,m.s_user_id,?,?,m.auth_version,?,? FROM starry_members m JOIN starry_identities i ON i.s_user_id=m.s_user_id WHERE m.s_user_id=? AND m.status='active' AND m.auth_version=? AND i.provider=? AND i.subject=?"
  self.rotate="UPDATE starry_sessions SET refresh_hash=?,expires_at=? WHERE session_id=? AND s_user_id=? AND app_id=? AND environment=? AND auth_version=? AND refresh_hash=? AND revoked_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM starry_members m WHERE m.s_user_id=starry_sessions.s_user_id AND m.status='active' AND m.auth_version=starry_sessions.auth_version)"
 def tearDown(self):self.db.close()
 def insert(self,session='sid',user='s1',app='starry-id',env='staging',version=2,provider='apple',subject='apple-1',hash='a'*64):
  return self.db.execute(self.new,(session,app,env,hash,NOW+3600,user,version,provider,subject)).rowcount
 def test_active_subject_only_and_wrong_provider_or_user_deny(self):
  self.assertEqual(self.insert(subject='wrong'),0)
  self.assertEqual(self.insert(user='s2',version=3,provider='google',subject='google-2'),0)
  self.assertEqual(self.insert(version=4),0)
  self.assertEqual(self.insert(),1)
 def test_unique_session_and_refresh_hash(self):
  self.assertEqual(self.insert(),1)
  with self.assertRaises(sqlite3.IntegrityError):self.insert()
  with self.assertRaises(sqlite3.IntegrityError):self.insert(session='sid2')
 def test_refresh_atomic_CAS_replay_and_rollback(self):
  self.insert()
  values=('b'*64,NOW+7200,'sid','s1','starry-id','staging',2,'a'*64,NOW)
  self.assertEqual(self.db.execute(self.rotate,values).rowcount,1)
  self.assertEqual(self.db.execute(self.rotate,values).rowcount,0)
  self.assertEqual(self.db.execute("SELECT refresh_hash FROM starry_sessions WHERE session_id='sid'").fetchone()[0],'b'*64)
 def test_scope_and_version_revocation(self):
  self.insert()
  vals=('b'*64,NOW+7200,'sid','s1','wrong-app','staging',2,'a'*64,NOW)
  self.assertEqual(self.db.execute(self.rotate,vals).rowcount,0)
  self.db.execute("UPDATE starry_members SET auth_version=auth_version+1 WHERE s_user_id='s1' AND auth_version=2")
  vals=('b'*64,NOW+7200,'sid','s1','starry-id','staging',2,'a'*64,NOW)
  self.assertEqual(self.db.execute(self.rotate,vals).rowcount,0)
 def test_revoked_session_fail(self):
  self.insert()
  self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE session_id='sid'",(NOW,))
  vals=('b'*64,NOW+7200,'sid','s1','starry-id','staging',2,'a'*64,NOW)
  self.assertEqual(self.db.execute(self.rotate,vals).rowcount,0)
if __name__=='__main__': unittest.main()
