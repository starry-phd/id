import pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent
class OAuthSqlTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for fn in ['001_starry_identity.DRAFT.sql','002_starry_store_bindings.DRAFT.sql','003_starry_oauth_round3.DRAFT.sql']:
   self.db.executescript((ROOT/'schema'/fn).read_text())
 def tearDown(self):self.db.close()
 def test_oauth_state_single_consume(self):
  self.db.execute("INSERT INTO starry_oauth_attempts VALUES (?,?,?,?,?,?,?,?,?,?)",
    ('st_'+ 'a'*40,'apple','starry-id','staging','phd.starry.id','challenge',
     'nonce',500,None,100))
  q="UPDATE starry_oauth_attempts SET consumed_at=? WHERE state=? AND provider=? AND consumed_at IS NULL AND expires_at>?"
  self.assertEqual(self.db.execute(q,(200,'st_'+'a'*40,'apple',200)).rowcount,1)
  self.assertEqual(self.db.execute(q,(201,'st_'+'a'*40,'apple',201)).rowcount,0)
 def test_session_issuer_rotation_and_revocation(self):
  self.db.execute("INSERT INTO starry_members VALUES (?,?,?,?,?,?,?,?,?)",
   ('s1','active',2,1,None,0,0,1,1))
  self.db.execute("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)",
   ('sid','s1','starry-id','staging',2,'hash_only_1',400))
  q="UPDATE starry_sessions SET revoked_at=? WHERE session_id=? AND s_user_id=? AND auth_version=? AND revoked_at IS NULL"
  self.assertEqual(self.db.execute(q,(100,'sid','s1',2)).rowcount,1)
  self.assertEqual(self.db.execute(q,(200,'sid','s1',2)).rowcount,0)
 def test_reject_duplicate_state_and_invalid_env(self):
  values=('st_'+'b'*40,'google','starry-id','staging','phd.starry.id','challenge','nonce',500,None,100)
  self.db.execute('INSERT INTO starry_oauth_attempts VALUES (?,?,?,?,?,?,?,?,?,?)',values)
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO starry_oauth_attempts VALUES (?,?,?,?,?,?,?,?,?,?)',values)
  wrong=list(values);wrong[0]='st_'+'c'*40;wrong[3]='sandbox'
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO starry_oauth_attempts VALUES (?,?,?,?,?,?,?,?,?,?)',wrong)
if __name__=='__main__':unittest.main()
