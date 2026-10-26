"""AI-1 Round5 disposable SQLite candidate: migration/rollback + replay rejection."""
from pathlib import Path
import sqlite3
import unittest

ROOT=Path(__file__).resolve().parent.parent/"schema"
class OidcMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:", isolation_level=None)
  self.db.execute("PRAGMA foreign_keys=ON")
  for name in ("001_starry_identity.DRAFT.sql","003_starry_oauth_round3.DRAFT.sql"):
   self.db.executescript((ROOT/name).read_text())
  self.s="S"*40
  self.db.execute(
   "INSERT INTO starry_oauth_attempts(state,provider,app_id,environment,client_id,code_challenge,nonce,expires_at,consumed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
   (self.s,"apple","starry-id","staging","phd.starry.id","a"*43,"nonce-from-backend-opaque",300,None,100))
  self.db.execute("INSERT INTO starry_members VALUES (?,?,?,?,?,?,?,?,?)",
   ("s-1","active",1,1,None,0,0,100,100))
  self.db.execute("INSERT INTO starry_identities VALUES (?,?,?)",("apple","apple-sub","s-1"))
  self.db.execute("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)",
   ("sid","s-1","starry-id","staging",1,"a"*64,300))
 def tearDown(self):self.db.close()
 def apply(self,name):self.db.executescript((ROOT/name).read_text())
 def indexes(self):
  return {row[1] for row in self.db.execute("SELECT type,name FROM sqlite_master WHERE type='index'")}
 def test_forward_and_rollback_are_idempotent_and_preserve_data(self):
  self.apply("005_starry_oidc_indexes.UP.DRAFT.sql")
  self.apply("005_starry_oidc_indexes.UP.DRAFT.sql")
  names=self.indexes()
  self.assertIn("idx_starry_oauth_pending_scope_v5",names)
  self.assertIn("idx_starry_sessions_scope_active_v5",names)
  self.apply("005_starry_oidc_indexes.DOWN.DRAFT.sql")
  self.apply("005_starry_oidc_indexes.DOWN.DRAFT.sql")
  self.assertNotIn("idx_starry_oauth_pending_scope_v5",self.indexes())
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_members").fetchone()[0],1)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions").fetchone()[0],1)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_oauth_attempts").fetchone()[0],1)
 def test_scope_and_one_winner_replay(self):
  self.apply("005_starry_oidc_indexes.UP.DRAFT.sql")
  query="UPDATE starry_oauth_attempts SET consumed_at=? WHERE state=? AND provider=? AND app_id=? AND environment=? AND client_id=? AND consumed_at IS NULL AND expires_at>?"
  self.assertEqual(self.db.execute(query,(200,self.s,"apple","starry-id","production","phd.starry.id",200)).rowcount,0)
  self.assertEqual(self.db.execute(query,(200,self.s,"google","starry-id","staging","phd.starry.id",200)).rowcount,0)
  self.assertEqual(self.db.execute(query,(200,self.s,"apple","starry-id","staging","phd.starry.id",200)).rowcount,1)
  self.assertEqual(self.db.execute(query,(201,self.s,"apple","starry-id","staging","phd.starry.id",201)).rowcount,0)
 def test_expired_and_wrong_client_fail_and_rollback_no_data_loss(self):
  self.apply("005_starry_oidc_indexes.UP.DRAFT.sql")
  query="UPDATE starry_oauth_attempts SET consumed_at=? WHERE state=? AND provider=? AND app_id=? AND environment=? AND client_id=? AND consumed_at IS NULL AND expires_at>?"
  self.assertEqual(self.db.execute(query,(301,self.s,"apple","starry-id","staging","phd.starry.id",301)).rowcount,0)
  self.assertEqual(self.db.execute(query,(200,self.s,"apple","starry-id","staging","hglobal-id",200)).rowcount,0)
  self.apply("005_starry_oidc_indexes.DOWN.DRAFT.sql")
  self.assertEqual(self.db.execute("SELECT consumed_at FROM starry_oauth_attempts").fetchone()[0],None)
 def test_session_scope_cannot_revoke_other_app(self):
  self.apply("005_starry_oidc_indexes.UP.DRAFT.sql")
  sql="UPDATE starry_sessions SET revoked_at=? WHERE session_id=? AND s_user_id=? AND app_id=? AND environment=? AND auth_version=? AND revoked_at IS NULL"
  self.assertEqual(self.db.execute(sql,(200,"sid","s-1","hglobal-id","staging",1)).rowcount,0)
  self.assertEqual(self.db.execute(sql,(200,"sid","s-1","starry-id","staging",1)).rowcount,1)
  self.assertEqual(self.db.execute(sql,(201,"sid","s-1","starry-id","staging",1)).rowcount,0)

if __name__=="__main__":unittest.main()
