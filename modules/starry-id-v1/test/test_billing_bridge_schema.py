import pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent
class BindingSqlTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript((ROOT/"schema/001_starry_identity.DRAFT.sql").read_text())
        self.db.executescript((ROOT/"schema/002_starry_store_bindings.DRAFT.sql").read_text())
        for uid in ("s1","s2"):
            self.db.execute("INSERT INTO starry_members VALUES (?,?,?,?,?,?,?,?,?)",(uid,"active",1,1,None,0,0,1,1))
        self.fields=("s1","starry-id","staging","apple","phd.starry.id","sandbox",
            "123e4567-e89b-42d3-a456-426614174000",None,None)
        self.sql="INSERT INTO starry_store_bindings VALUES (?,?,?,?,?,?,?,?,?)"
    def tearDown(self): self.db.close()
    def test_unique_account_binding_across_users(self):
        self.db.execute(self.sql,self.fields)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(self.sql,("s2",)+self.fields[1:])
    def test_single_authoritative_binding_per_user_app_store_runtime(self):
        self.db.execute(self.sql,self.fields)
        nextval=list(self.fields);nextval[6]="123e4567-e89b-42d3-a456-426614174001"
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute(self.sql,nextval)
    def test_cross_environment_and_foreign_key_reject(self):
        bad=list(self.fields);bad[2]="sandbox"
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute(self.sql,bad)
        bad=list(self.fields);bad[0]="unknown"
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute(self.sql,bad)
    def test_revocation_cas_blocks_repeated_use(self):
        self.db.execute(self.sql,self.fields)
        q=("UPDATE starry_store_bindings SET revoked_at=? WHERE s_user_id=?"
           " AND app_id=? AND environment=? AND store=?"
           " AND store_app_id=? AND store_environment=? AND revoked_at IS NULL")
        values=(50,"s1","starry-id","staging","apple","phd.starry.id","sandbox")
        self.assertEqual(self.db.execute(q,values).rowcount,1)
        self.assertEqual(self.db.execute(q,values).rowcount,0)
        self.assertEqual(self.db.execute("SELECT revoked_at FROM starry_store_bindings").fetchone()[0],50)
if __name__=="__main__":unittest.main()
