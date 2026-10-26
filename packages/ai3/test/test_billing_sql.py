"""AI-3 design-only SQLite in-memory regression; never connects to Cloudflare D1."""
import pathlib,sqlite3,unittest
SQL=(pathlib.Path(__file__).parent.parent/'schema'/'001_audit_design.sql').read_text()
class AuditSQLite(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.executescript(SQL)
 def test_atomic_uniqueness_requires_domain_owned_insert(self):
  row=['starry','starry-id','staging','sandbox','evt_1','billing.renewed','prov_1','txn_1','2026-10-26T00:00:00Z','ready']
  q='INSERT INTO ai3_billing_audit_inbox VALUES(?,?,?,?,?,?,?,?,?,?)'
  self.db.execute(q,row)
  for i,v in [(4,'evt_2'),(6,'prov_2')]:
   conflict=row.copy();conflict[i]=v
   with self.assertRaises(sqlite3.IntegrityError):self.db.execute(q,conflict)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_billing_audit_inbox').fetchone()[0],1)
 def test_brand_store_and_battery_fail_closed(self):
  row=['starry','starry-id','staging','sandbox','evt_1','billing.renewed','prov_1','txn_1','2026-10-26T00:00:00Z','ready']
  q='INSERT INTO ai3_billing_audit_inbox VALUES(?,?,?,?,?,?,?,?,?,?)'
  for i,v in [(0,'hglobal'),(3,'production'),(5,'battery.purchase'),(9,'paid')]:
   bad=row.copy();bad[i]=v
   with self.assertRaises(sqlite3.IntegrityError):self.db.execute(q,bad)
if __name__=='__main__':unittest.main()
