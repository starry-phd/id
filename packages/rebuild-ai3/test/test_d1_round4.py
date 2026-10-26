"""Round4 AI-3 D1 SQL: SQLite :memory: only. No real D1, Wrangler or cloud."""
import sqlite3,pathlib,unittest
SQL=(pathlib.Path(__file__).resolve().parent.parent/'schema'/'0004_d1_atomic_DRAFT.sql').read_text()
KEY='b_'+'a'*64
class D1R4(unittest.TestCase):
 def setUp(self):
  self.uri='file:ai3r4_'+self._testMethodName+'?mode=memory&cache=shared'
  self.db=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.db.execute('PRAGMA foreign_keys=ON')
  self.db.executescript(SQL)
  self.inbox=('starry','starry-id','staging',KEY,KEY,'b'*64)
  self.audit=('starry','starry-id','staging',KEY,KEY,'rebuild-ai3.0.1-candidate',
   'billing.store_state_observed','2026-10-26T08:12:00Z','anon_safe',KEY,'metadata_only','recorded')
  self.i1="""INSERT INTO ai3_r4_inbox(brand_id,app_id,environment,idempotency_key,event_id,payload_digest)
   VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,app_id,environment,idempotency_key) DO NOTHING"""
  self.i2="""INSERT INTO ai3_r4_audit(brand_id,app_id,environment,event_id,idempotency_key,
   schema_version,event_type,occurred_at,actor_ref,resource_ref,classification,result)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(
    SELECT 1 FROM ai3_r4_inbox WHERE brand_id=? AND app_id=? AND environment=?
    AND idempotency_key=? AND event_id=? AND payload_digest=?
   ) ON CONFLICT(brand_id,app_id,environment,event_id) DO NOTHING"""
 def tearDown(self):self.db.close()
 def counts(self):
  return tuple(self.db.execute('SELECT COUNT(*) FROM '+name).fetchone()[0]
   for name in ('ai3_r4_inbox','ai3_r4_audit'))
 def batch(self,claim=None,audit=None,crash=False):
  c=claim or self.inbox
  self.db.execute('BEGIN IMMEDIATE')
  try:
   before=self.db.execute(self.i1,c).rowcount
   if crash:raise RuntimeError('crash before audit append')
   appended=self.db.execute(self.i2,(audit or self.audit)+c).rowcount
   self.db.commit();return before,appended
  except:
   self.db.rollback();raise
 def test_atomic_pair(self):
  self.assertEqual(self.batch(),(1,1));self.assertEqual(self.counts(),(1,1))
 def test_lost_ack_duplicate_no_second_append(self):
  self.batch();self.assertEqual(self.batch(),(0,0));self.assertEqual(self.counts(),(1,1))
 def test_conflicting_payload_digest_no_second_append(self):
  self.batch();bad=list(self.inbox);bad[5]='c'*64
  self.assertEqual(self.batch(claim=tuple(bad)),(0,0))
  self.assertEqual(self.counts(),(1,1))
 def test_crash_before_append_rolls_back(self):
  with self.assertRaises(RuntimeError):self.batch(crash=True)
  self.assertEqual(self.counts(),(0,0))
 def test_failed_append_wrong_version_rolls_back(self):
  bad=list(self.audit);bad[5]='wrong-version'
  with self.assertRaises(sqlite3.IntegrityError):self.batch(audit=tuple(bad))
  self.assertEqual(self.counts(),(0,0))
 def test_reject_cross_brand_and_production(self):
  for ix,value in ((0,'hglobal'),(2,'sandbox'),(2,'production')):
   bad=list(self.inbox);bad[ix]=value
   with self.assertRaises(sqlite3.IntegrityError):self.batch(claim=tuple(bad))
  self.assertEqual(self.counts(),(0,0))
 def test_other_app_is_distinct_scope(self):
  self.batch()
  c=list(self.inbox);c[1]='other'
  e=list(self.audit);e[1]='other'
  self.assertEqual(self.batch(tuple(c),tuple(e)),(1,1))
  self.assertEqual(self.counts(),(2,2))
 def test_competing_second_connection_cannot_steal_claim(self):
  peer=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  peer.execute('PRAGMA foreign_keys=ON')
  self.db.execute('BEGIN IMMEDIATE')
  try:
   self.db.execute(self.i1,self.inbox)
   with self.assertRaises(sqlite3.OperationalError):peer.execute('BEGIN IMMEDIATE')
   self.db.rollback()
   peer.execute('BEGIN IMMEDIATE')
   peer.execute(self.i1,self.inbox)
   peer.execute(self.i2,self.audit+self.inbox);peer.commit()
   self.assertEqual(self.counts(),(1,1))
  finally:
   self.db.rollback();peer.close()
 def test_quarantine_durable_idempotent(self):
  q="""INSERT INTO ai3_r4_quarantine VALUES(?,?,?,?,?)
   ON CONFLICT(brand_id,app_id,environment,idempotency_key,reason) DO NOTHING"""
  v=('starry','starry-id','staging',KEY,'STALE_BILLING_EVENT')
  self.db.execute(q,v);self.db.execute(q,v)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_r4_quarantine').fetchone()[0],1)
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute(q,('hglobal',)+v[1:])
 def test_audit_append_only_no_pii(self):
  self.batch()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE ai3_r4_audit SET actor_ref='fake'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('DELETE FROM ai3_r4_audit')
  cols={row[1] for row in self.db.execute('PRAGMA table_info(ai3_r4_audit)')}
  self.assertTrue(cols.isdisjoint({'email','phone','token','raw_receipt','s_user_id','payload_json'}))
 def test_digest_mismatch_cannot_append(self):
  self.db.execute('INSERT INTO ai3_r4_inbox VALUES(?,?,?,?,?,?)',self.inbox)
  bad=list(self.inbox);bad[5]='c'*64
  self.assertEqual(self.db.execute(self.i2,self.audit+tuple(bad)).rowcount,0)
  self.assertEqual(self.counts(),(1,0))
if __name__=='__main__':unittest.main()
