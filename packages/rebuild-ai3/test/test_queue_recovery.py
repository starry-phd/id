"""Fault cases only in SQLite shared in-memory database."""
import sqlite3,unittest,pathlib
SCHEMA=(pathlib.Path(__file__).parent.parent/'schema'/'0003_queue_atomic_DRAFT.sql').read_text()
KEY='b_'+'a'*64
class QueueFault(unittest.TestCase):
 def setUp(self):
  self.uri='file:ai3_'+self._testMethodName+'?mode=memory&cache=shared'
  self.db=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.db.executescript(SCHEMA)
  self.claim=['starry','starry-id','staging',KEY,KEY,'b'*64]
  self.audit=['starry','starry-id','staging',KEY,'rebuild-ai3.0.1-candidate','billing.store_state_observed','anon_one',KEY]
  self.i1='INSERT INTO ai3_r3_claim VALUES(?,?,?,?,?,?)'
  self.i2='INSERT INTO ai3_r3_append VALUES(?,?,?,?,?,?,?,?)'
 def tearDown(self):self.db.close()
 def write(self,claim=None,audit=None,crash=False):
  self.db.execute('BEGIN IMMEDIATE')
  try:
   self.db.execute(self.i1,claim or self.claim)
   if crash:raise RuntimeError('crash-after-claim')
   self.db.execute(self.i2,audit or self.audit)
   self.db.commit()
  except:
   self.db.rollback();raise
 def n(self,table):return self.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]
 def test_atomic_both_records(self):
  self.write();self.assertEqual(self.n('ai3_r3_claim'),1);self.assertEqual(self.n('ai3_r3_append'),1)
 def test_crash_before_audit_rolls_back_claim(self):
  with self.assertRaises(RuntimeError):self.write(crash=True)
  self.assertEqual(self.n('ai3_r3_claim'),0);self.write()
 def test_duplicate_after_ack_crash_is_one_audit(self):
  self.write()
  with self.assertRaises(sqlite3.IntegrityError):self.write()
  self.assertEqual(self.n('ai3_r3_append'),1)
 def test_changed_digest_and_second_event_id_do_not_mutate(self):
  self.write()
  for pos,val in [(5,'c'*64),(4,'b_'+'c'*64)]:
   r=self.claim.copy();r[pos]=val
   with self.assertRaises(sqlite3.IntegrityError):self.write(claim=r)
  self.assertEqual(self.n('ai3_r3_append'),1)
 def test_cross_brand_runtime_and_wrong_schema_all_rollback(self):
  for pos,val in [(0,'hglobal'),(2,'production'),(2,'sandbox')]:
   r=self.claim.copy();r[pos]=val
   with self.assertRaises(sqlite3.IntegrityError):self.write(claim=r)
  a=self.audit.copy();a[4]='unapproved'
  with self.assertRaises(sqlite3.IntegrityError):self.write(audit=a)
  self.assertEqual(self.n('ai3_r3_claim'),0)
 def test_two_writers_compete_for_same_atomic_claim(self):
  peer=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.db.execute('BEGIN IMMEDIATE')
  try:
   self.db.execute(self.i1,self.claim)
   with self.assertRaises(sqlite3.OperationalError):peer.execute('BEGIN IMMEDIATE')
   self.db.rollback()
   peer.execute('BEGIN IMMEDIATE')
   peer.execute(self.i1,self.claim);peer.execute(self.i2,self.audit);peer.commit()
   self.assertEqual(self.n('ai3_r3_append'),1)
  finally:
   self.db.rollback();peer.close()
 def test_durable_quarantine_and_append_only(self):
  self.write()
  self.db.execute('INSERT INTO ai3_r3_quarantine VALUES(?,?,?,?,?)',
   ('starry','starry-id','staging',KEY,'DIGEST_CONFLICT'))
  self.assertEqual(self.n('ai3_r3_quarantine'),1)
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE ai3_r3_append SET actor_ref='fake'")
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute('DELETE FROM ai3_r3_append')
 def test_no_personal_columns_or_billing_rights(self):
  columns={r[1] for r in self.db.execute('PRAGMA table_info(ai3_r3_append)')}
  for v in ['email','phone','token','s_user_id','accountBinding','raw_receipt']:
   self.assertNotIn(v,columns)
  tables={r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  self.assertNotIn('billing_entitlement',tables)
if __name__=='__main__':unittest.main()
