import sqlite3,unittest
from pathlib import Path
SQL=(Path(__file__).resolve().parent.parent/'schema'/'001_starry_auth.DRAFT.sql').read_text()
class SchemaTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.executescript(SQL)
  self.db.execute('INSERT INTO starry_members VALUES (?,?,?,?,?)',('u1','active',1,100,100))
 def tearDown(self):self.db.close()
 def test_provider_subject_unique(self):
  self.db.execute('INSERT INTO starry_oidc_identities VALUES (?,?,?,?)',('google','sub','u1',100))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO starry_oidc_identities VALUES (?,?,?,?)',('google','sub','u1',100))
 def test_refresh_cas_replay_cannot_double_rotate(self):
  self.db.execute('INSERT INTO starry_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',('s1','u1','a','staging',1,'old',1,200,None,None,100,100))
  q='UPDATE starry_sessions SET refresh_hash=?,refresh_version=refresh_version+1 WHERE session_id=? AND refresh_hash=? AND refresh_version=? AND revoked_at IS NULL AND expires_at>?'
  self.assertEqual(self.db.execute(q,('new1','s1','old',1,110)).rowcount,1)
  self.assertEqual(self.db.execute(q,('new2','s1','old',1,110)).rowcount,0)
 def test_invalid_admin_action_rejected(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO starry_admin_grants VALUES (?,?,?,?,?,?,?,?,?)',('g1','u1','a','staging','member','superuser',200,None,100))
if __name__=='__main__':unittest.main()
