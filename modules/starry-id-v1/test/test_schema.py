import pathlib, sqlite3, unittest
PATH = pathlib.Path(__file__).parent.parent / "schema" / "001_starry_identity.DRAFT.sql"
class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(PATH.read_text())
        self.db.execute("INSERT INTO starry_members VALUES (?,?,?,?,?,?,?,?,?)",
            ("s1","active",1,1,"Example",0,0,1,1))
        self.db.commit()
    def tearDown(self): self.db.close()
    def test_identities_unique_stable_provider_subject_not_email(self):
        self.db.execute("INSERT INTO starry_identities VALUES (?,?,?)",("google","stable-sub","s1"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO starry_identities VALUES (?,?,?)",("google","stable-sub","s1"))
    def test_profile_cas_only_once(self):
        q="UPDATE starry_members SET display_name=?, profile_revision=profile_revision+1 WHERE s_user_id=? AND profile_revision=? AND status='active'"
        self.assertEqual(self.db.execute(q,("Alias","s1",1)).rowcount,1)
        self.assertEqual(self.db.execute(q,("Overwrite","s1",1)).rowcount,0)
    def test_atomic_member_revoke_and_session_in_memory(self):
        self.db.execute("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)",
            ("ss","s1","starry-id","staging",1,"hash-only",500))
        with self.db:
            self.db.execute("UPDATE starry_members SET status='deleted',auth_version=auth_version+1,display_name=NULL,directory_opt_in=0,display_name_public=0 WHERE s_user_id='s1'")
            self.db.execute("UPDATE starry_sessions SET revoked_at=50 WHERE s_user_id='s1' AND revoked_at IS NULL")
        self.assertEqual(self.db.execute("SELECT status,auth_version,display_name FROM starry_members WHERE s_user_id='s1'").fetchone(),("deleted",2,None))
        self.assertEqual(self.db.execute("SELECT revoked_at FROM starry_sessions WHERE session_id='ss'").fetchone()[0],50)
    def test_refresh_rotation_cas(self):
        self.db.execute("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)",
            ("ss","s1","starry-id","staging",1,"old-hash",500))
        q="UPDATE starry_sessions SET refresh_hash=? WHERE session_id=? AND refresh_hash=? AND auth_version=? AND revoked_at IS NULL AND expires_at>?"
        self.assertEqual(self.db.execute(q,("new-hash","ss","old-hash",1,50)).rowcount,1)
        self.assertEqual(self.db.execute(q,("attacker","ss","old-hash",1,50)).rowcount,0)
        self.assertEqual(self.db.execute(q,("old","ss","new-hash",1,600)).rowcount,0)
    def test_scope_and_grant_constraints(self):
        for stmt in [
            ("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)",
                ("bad","s1","app","sandbox",1,"h",500)),
            ("INSERT INTO starry_admin_grants VALUES (?,?,?,?,?,?,?)",
                ("bad","s1","app","staging","refund:cash",500,None))
        ]:
            with self.assertRaises(sqlite3.IntegrityError): self.db.execute(*stmt)
if __name__ == "__main__": unittest.main()
