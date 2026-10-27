"""R8 AI-1 Q119 privacy Gate schema and Q88 deletion race: disposable SQLite only."""
import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
CAS="UPDATE starry_members SET status='deleted',auth_version=?,display_name=NULL,directory_opt_in=0,display_name_public=0,profile_revision=?,updated_at=? WHERE s_user_id=? AND status='active' AND auth_version=? AND profile_revision=?"
REVOKE=("UPDATE starry_sessions SET revoked_at=? WHERE s_user_id=? AND revoked_at IS NULL "
 "AND EXISTS(SELECT 1 FROM starry_members WHERE s_user_id=? "
 "AND status='deleted' AND auth_version=? AND updated_at=?)")
class PrivacyAndDeletionRace(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for p in ('001_starry_identity.DRAFT.sql',
    '007_starry_age_deletion_admin.UP.DRAFT.sql',
    '008_starry_first_gift_privacy.UP.DRAFT.sql'):
   self.db.executescript((ROOT/p).read_text())
  self.db.execute("INSERT INTO starry_members VALUES('u1','active',3,1,'name',0,0,?,?)",(NOW,NOW))
  self.db.executemany("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)",[
   ('s1','u1','starry-app-a','staging',3,'a'*64,NOW+900),
   ('s2','u1','starry-app-b','staging',3,'b'*64,NOW+900)])
 def tearDown(self):self.db.close()
 def test_failed_member_CAS_must_not_revoke_valid_Starry_sessions(self):
  self.assertEqual(self.db.execute(REVOKE,(NOW,'u1','u1',4,NOW)).rowcount,0)
  self.assertEqual(self.db.execute(CAS,(4,2,NOW,'u1',99,1)).rowcount,0)
  self.assertEqual(self.db.execute(REVOKE,(NOW,'u1','u1',4,NOW)).rowcount,0)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE revoked_at IS NULL").fetchone()[0],2)
 def test_valid_atomic_member_CAS_then_session_revocation_all_Starry_apps(self):
  self.db.execute('BEGIN IMMEDIATE')
  self.assertEqual(self.db.execute(CAS,(4,2,NOW,'u1',3,1)).rowcount,1)
  self.assertEqual(self.db.execute(REVOKE,(NOW,'u1','u1',4,NOW)).rowcount,2)
  self.db.execute('COMMIT')
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE revoked_at IS NULL").fetchone()[0],0)
  self.assertEqual(self.db.execute("SELECT status,auth_version FROM starry_members").fetchone(),('deleted',4))
  self.assertEqual(self.db.execute(REVOKE,(NOW+1,'u1','u1',4,NOW+1)).rowcount,0)
 def test_atomic_rollback_of_auth_revocation(self):
  self.db.execute('BEGIN IMMEDIATE')
  self.assertEqual(self.db.execute(CAS,(4,2,NOW,'u1',3,1)).rowcount,1)
  self.assertEqual(self.db.execute(REVOKE,(NOW,'u1','u1',4,NOW)).rowcount,2)
  self.db.execute('ROLLBACK')
  self.assertEqual(self.db.execute("SELECT status,auth_version FROM starry_members").fetchone(),('active',3))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE revoked_at IS NULL").fetchone()[0],2)
 def test_pseudonym_cannot_claim_twice_and_contains_no_original_identity(self):
  f='a'*64
  self.db.execute('INSERT INTO starry_first_gift_claims VALUES (?,?,?)',(f,1,NOW))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO starry_first_gift_claims VALUES (?,?,?)',(f,1,NOW+1))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO starry_first_gift_claims VALUES (?,?,?)',('provider-sub-secret',1,NOW))
  cols={r[1] for r in self.db.execute('PRAGMA table_info(starry_first_gift_claims)')}
  self.assertEqual(cols,{'fingerprint','claim_version','claimed_at'})
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_first_gift_claims').fetchone()[0],1)
 def test_down_migration_preserves_member_sessions_and_irreversibility(self):
  self.db.executescript((ROOT/'008_starry_first_gift_privacy.DOWN.DRAFT.sql').read_text())
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_members').fetchone()[0],1)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_sessions').fetchone()[0],2)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='starry_first_gift_claims'").fetchone()[0],0)
  self.db.execute(CAS,(4,2,NOW,'u1',3,1))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE starry_members SET status='active' WHERE s_user_id='u1'")
if __name__=='__main__':unittest.main()
