"""AI-1 R9 real disposable SQLite :memory: grant and rollback tests."""
import unittest,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
SELECT=("SELECT g.permission,g.expires_at,g.revoked_at,g.auth_version,"
 "a.role,a.revoked_at AS role_revoked_at,"
 "m.auth_version AS member_version,m.status AS member_status "
 "FROM starry_privacy_review_grants g JOIN starry_members m ON m.s_user_id=g.s_user_id "
 "JOIN starry_admin_roles a ON a.s_user_id=g.s_user_id AND a.environment=g.environment "
 "WHERE g.s_user_id=? AND g.app_id=? AND g.environment=? AND g.permission=? LIMIT 1")
class ReviewerGrantSQL(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  for f in ('001_starry_identity.DRAFT.sql','007_starry_age_deletion_admin.UP.DRAFT.sql'):
   self.db.executescript((ROOT/f).read_text())
  self.db.execute("INSERT INTO starry_members VALUES ('u1','active',3,1,NULL,0,0,?,?)",(NOW,NOW))
  self.db.execute("INSERT INTO starry_members VALUES ('u2','active',3,1,NULL,0,0,?,?)",(NOW,NOW))
  self.db.execute("INSERT INTO starry_admin_roles VALUES ('u1','staging','supreme',NULL)")
  self.db.execute("INSERT INTO starry_admin_roles VALUES ('u2','staging','delegated',NULL)")
  self.up()
 def up(self):self.db.executescript((ROOT/'009_starry_privacy_review_grants.UP.DRAFT.sql').read_text())
 def row(self,user='u1',app='starry-id',env='staging',permission='appeal:review_status'):
  return self.db.execute(SELECT,(user,app,env,permission)).fetchone()
 def grant(self,user='u1',app='starry-id',env='staging',permission='appeal:review_status'):
  self.db.execute("INSERT INTO starry_privacy_review_grants VALUES(?,?,?,?,?,?,NULL)",
   (user,app,env,permission,3,NOW+60))
 def tearDown(self):self.db.close()
 def test_no_implicit_supreme_access_and_scoped_permissions(self):
  self.assertIsNone(self.row())
  self.grant()
  self.assertEqual(self.row()[0],'appeal:review_status')
  self.assertIsNone(self.row(env='production'))
  self.assertIsNone(self.row(app='hglobal-id'))
  self.assertIsNone(self.row(permission='privacy:review_retention'))
 def test_delegated_requires_explicit_capability_and_no_duplicate(self):
  self.assertIsNone(self.row(user='u2'))
  self.grant(user='u2')
  self.assertEqual(self.row(user='u2')[4],'delegated')
  with self.assertRaises(sqlite3.IntegrityError):self.grant(user='u2')
  with self.assertRaises(sqlite3.IntegrityError):self.grant(user='missing')
 def test_revocation_stale_auth_and_suspend_are_visible_to_authority(self):
  self.grant()
  self.db.execute("UPDATE starry_privacy_review_grants SET revoked_at=? WHERE s_user_id='u1'",(NOW,))
  self.assertEqual(self.row()[2],NOW)
  self.db.execute("UPDATE starry_members SET auth_version=4,status='suspended' WHERE s_user_id='u1'")
  self.assertEqual(self.row()[6:],(4,'suspended'))
  self.assertNotEqual(self.row()[3],self.row()[6])
 def test_bad_permissions_and_required_domain_rejected_by_sql(self):
  with self.assertRaises(sqlite3.IntegrityError):self.grant(permission='member:delete')
  with self.assertRaises(sqlite3.IntegrityError):self.grant(env='other')
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO starry_privacy_review_grants VALUES('u1','starry-id','staging','appeal:review_status',0,?,NULL)",(NOW,))
 def test_idempotent_schema_and_reverse_migration_preserves_original_member(self):
  self.up();self.grant()
  self.db.executescript((ROOT/'009_starry_privacy_review_grants.DOWN.DRAFT.sql').read_text())
  self.db.executescript((ROOT/'009_starry_privacy_review_grants.DOWN.DRAFT.sql').read_text())
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_members').fetchone()[0],2)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_admin_roles').fetchone()[0],2)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='starry_privacy_review_grants'").fetchone()[0],0)
if __name__=='__main__':unittest.main()
