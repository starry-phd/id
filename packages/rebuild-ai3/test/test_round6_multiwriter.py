"""R6 Queue/D1 multi-writer memory simulation. NOT Cloudflare D1 verification."""
import sqlite3,unittest,pathlib
SCHEMA=(pathlib.Path(__file__).parent.parent/'schema'/'0004_d1_atomic_DRAFT.sql').read_text()
KEY='b_'+'a'*64
DIGEST='b'*64
class Round6D1Race(unittest.TestCase):
 def setUp(self):
  self.uri='file:ai3_r6_'+self._testMethodName+'?mode=memory&cache=shared'
  self.a=sqlite3.connect(self.uri,uri=True,isolation_level=None,timeout=0)
  self.b=sqlite3.connect(self.uri,uri=True,isolation_level=None,timeout=0)
  self.a.execute('PRAGMA foreign_keys=ON')
  self.b.execute('PRAGMA foreign_keys=ON')
  self.a.executescript(SCHEMA)
  self.qi='INSERT INTO ai3_r4_inbox VALUES(?,?,?,?,?,?)'
  self.qa='INSERT INTO ai3_r4_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  self.qc='INSERT INTO ai3_r4_quarantine VALUES(?,?,?,?,?)'
  self.i=('starry','starry.test','staging',KEY,KEY,DIGEST)
  self.aud=('starry','starry.test','staging',KEY,KEY,'rebuild-ai3.0.1-candidate',
   'billing.store_state_observed','2026-10-26T10:10:00Z','anon_a',KEY,'metadata_only','recorded')
 def tearDown(self):self.b.close();self.a.close()
 def sizes(self):
  return tuple(self.a.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in
   ['ai3_r4_inbox','ai3_r4_audit','ai3_r4_quarantine'])
 def write(self,conn,crash=False):
  conn.execute('BEGIN IMMEDIATE')
  try:
   conn.execute(self.qi,self.i)
   if crash:raise RuntimeError('crash-after-inbox')
   conn.execute(self.qa,self.aud)
   conn.commit()
  except:
   conn.rollback();raise
 def test_atomic_crash_after_claim_rolls_back_no_ack(self):
  with self.assertRaises(RuntimeError):self.write(self.a,True)
  self.assertEqual(self.sizes(),(0,0,0))
  self.write(self.b);self.assertEqual(self.sizes(),(1,1,0))
 def test_two_concurrent_writer_lock_then_recovery(self):
  self.a.execute('BEGIN IMMEDIATE')
  try:
   self.a.execute(self.qi,self.i)
   with self.assertRaises(sqlite3.OperationalError):self.b.execute('BEGIN IMMEDIATE')
   self.a.rollback()
   self.write(self.b)
  finally:self.a.rollback()
  self.assertEqual(self.sizes(),(1,1,0))
 def test_repeated_insert_cannot_duplicate_audit(self):
  self.write(self.a)
  for _ in range(12):
   with self.assertRaises(sqlite3.IntegrityError):self.write(self.b)
  self.assertEqual(self.sizes(),(1,1,0))
 def test_digest_conflict_preserves_original_digest(self):
  self.write(self.a)
  bad=self.i[:5]+('c'*64,)
  with self.assertRaises(sqlite3.IntegrityError):self.b.execute(self.qi,bad)
  self.assertEqual(self.a.execute('SELECT payload_digest FROM ai3_r4_inbox').fetchone()[0],DIGEST)
 def test_stale_refund_quarantine_once_no_billing_mutation(self):
  row=('starry','starry.test','staging',KEY,'STALE_BILLING_EVENT')
  self.a.execute(self.qc,row)
  with self.assertRaises(sqlite3.IntegrityError):self.b.execute(self.qc,row)
  self.assertEqual(self.sizes(),(0,0,1))
  tables={x[0] for x in self.a.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  self.assertNotIn('billing_entitlement',tables)
 def test_quarantine_crash_before_commit_not_durable(self):
  self.a.execute('BEGIN IMMEDIATE')
  self.a.execute(self.qc,('starry','starry.test','staging',KEY,'AI0_P05_NOT_APPROVED'))
  self.a.rollback()
  self.assertEqual(self.sizes(),(0,0,0))
 def test_quarantine_brand_runtime_invalid_reason_rejected(self):
  for pos,value in [(0,'hglobal'),(2,'production'),(2,'sandbox'),(4,'PII_EMAIL')]:
   row=['starry','starry.test','staging',KEY,'STALE_BILLING_EVENT']
   row[pos]=value
   with self.assertRaises(sqlite3.IntegrityError):self.a.execute(self.qc,row)
  self.assertEqual(self.sizes(),(0,0,0))
 def test_schema_no_pii_or_billing_rights(self):
  for table in ['ai3_r4_inbox','ai3_r4_audit','ai3_r4_quarantine']:
   cols={x[1] for x in self.a.execute('PRAGMA table_info('+table+')')}
   for forbidden in ['email','s_user_id','phone','receipt','accountBinding','token','payload_json']:
    self.assertNotIn(forbidden,cols)
 def test_append_only_audit_no_update_or_delete(self):
  self.write(self.a)
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute("UPDATE ai3_r4_audit SET actor_ref='pii'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.b.execute('DELETE FROM ai3_r4_audit')
  self.assertEqual(self.sizes(),(1,1,0))
if __name__=='__main__':unittest.main()
