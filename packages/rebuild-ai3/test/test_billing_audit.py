"""AI-3 design-only Billing->Audit single D1 transaction simulation. No real D1."""
import pathlib,sqlite3,unittest
SCHEMA=(pathlib.Path(__file__).resolve().parent.parent/'schema'/'0001_audit_DRAFT.sql').read_text()
BILL=(pathlib.Path(__file__).resolve().parent.parent/'schema'/'0002_billing_audit_DRAFT.sql').read_text()
HEX='a'*64;ALT='b'*64
class BillingAuditSQLite(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.executescript(SCHEMA+'\n'+BILL)
  self.row=['starry','starry-id','staging','sandbox','b_'+HEX,
   'a_'+HEX,'r_'+ALT,ALT,'2026-10-26T07:00:00Z','ready']
  self.sql='INSERT INTO ai3_billing_audit_claim VALUES(?,?,?,?,?,?,?,?,?,?)'
 def test_replay_dedup_same_key_and_conflicting_digest(self):
  self.db.execute(self.sql,self.row)
  for i,x in [(7,HEX),(5,'a_'+ALT),(9,'stale_audit_only')]:
   value=self.row.copy();value[i]=x
   with self.assertRaises(sqlite3.IntegrityError):self.db.execute(self.sql,value)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_billing_audit_claim').fetchone()[0],1)
 def test_same_event_id_reused_with_new_idempotency_key_is_denied(self):
  self.db.execute(self.sql,self.row)
  v=self.row.copy();v[4]='b_'+ALT
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute(self.sql,v)
 def test_isolate_scope_and_reject_other_brand_prod_store_environment(self):
  for i,x in [(0,'hglobal'),(2,'sandbox'),(2,'production'),(3,'production'),
   (4,'client_key'),(7,'invalid_digest'),(9,'paid')]:
   v=self.row.copy();v[i]=x
   with self.assertRaises(sqlite3.IntegrityError):self.db.execute(self.sql,v)
  self.db.execute(self.sql,self.row)
  value=self.row.copy();value[1]='another-app';value[5]='a_'+ALT
  self.db.execute(self.sql,value)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_billing_audit_claim').fetchone()[0],2)
 def test_atomic_claim_plus_audit_fails_together(self):
  audit=['a_'+HEX,'starry','starry-id','staging','billing.store_state_observed',
   'rebuild-ai3.0.1-candidate','2026-10-26T07:00:00Z','b_'+HEX,
   'r_'+ALT,'billing_verified_service','recorded','metadata_only']
  with self.db:
   self.db.execute(self.sql,self.row)
   self.db.execute('INSERT INTO ai3_audit_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',audit)
  with self.assertRaises(sqlite3.IntegrityError):
   with self.db:
    bad=self.row.copy();bad[5]='a_'+ALT;bad[4]='b_'+ALT
    self.db.execute(self.sql,bad)
    self.db.execute('INSERT INTO ai3_audit_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',audit)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_billing_audit_claim').fetchone()[0],1)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_audit_metadata').fetchone()[0],1)
 def test_out_of_order_is_audit_only_never_mutates_entitlements(self):
  old=self.row.copy();old[9]='stale_audit_only'
  self.db.execute(self.sql,old)
  self.assertEqual(self.db.execute('SELECT decision FROM ai3_billing_audit_claim').fetchone()[0],'stale_audit_only')
  self.assertNotIn('billing_entitlement',{x[0] for x in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")})
 def test_no_raw_personal_or_receipt_columns(self):
  cols={r[1] for r in self.db.execute('PRAGMA table_info(ai3_billing_audit_claim)')}
  for k in ['email','user_id','s_user_id','jwt','store_token','raw_receipt','accountBinding','payload_json']:
   self.assertNotIn(k,cols)
if __name__=='__main__':unittest.main()
