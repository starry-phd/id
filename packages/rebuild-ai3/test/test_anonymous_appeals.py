"""Q114 anonymous appeal DRAFT migration run ONLY in SQLite :memory:."""
import pathlib,sqlite3,unittest
S=(pathlib.Path(__file__).parent.parent/'schema'/'0006_anonymous_appeal_DRAFT.sql').read_text()
CASE='case_'+'a'*64
KEY='a_'+'b'*64
HASH='c'*64
class AnonymousSQLite(unittest.TestCase):
 def setUp(self):
  self.uri='file:anon_'+self._testMethodName+'?mode=memory&cache=shared'
  self.a=sqlite3.connect(self.uri,uri=True,isolation_level=None,timeout=0)
  self.b=sqlite3.connect(self.uri,uri=True,isolation_level=None,timeout=0)
  self.a.execute('PRAGMA foreign_keys=ON');self.b.execute('PRAGMA foreign_keys=ON')
  self.a.executescript(S)
  self.insert='INSERT INTO ai3_appeal_case VALUES(?,?,?,?,?,?,?,?,?,?)'
  self.row=(CASE,'starry','starry-id','staging',KEY,'ACCESS_REVIEW',HASH,1000,1000,'received')
 def tearDown(self):self.b.close();self.a.close()
 def test_unique_idempotency_scope(self):
  self.a.execute(self.insert,self.row)
  alt=list(self.row);alt[0]='case_'+'d'*64
  with self.assertRaises(sqlite3.IntegrityError):self.b.execute(self.insert,alt)
 def test_atomic_rollback_on_failed_create(self):
  self.a.execute('BEGIN IMMEDIATE');self.a.execute(self.insert,self.row);self.a.rollback()
  self.assertEqual(self.b.execute('SELECT COUNT(*) FROM ai3_appeal_case').fetchone()[0],0)
 def test_two_writer_lock_and_recovery(self):
  self.a.execute('BEGIN IMMEDIATE');self.a.execute(self.insert,self.row)
  with self.assertRaises(sqlite3.OperationalError):self.b.execute('BEGIN IMMEDIATE')
  self.a.rollback();self.b.execute(self.insert,self.row)
  self.assertEqual(self.a.execute('SELECT COUNT(*) FROM ai3_appeal_case').fetchone()[0],1)
 def test_no_cross_brand_prod_or_weak_case_digest(self):
  for n,v in [(0,'weak'),(1,'hglobal'),(3,'production'),(6,'raw_token')]:
   r=list(self.row);r[n]=v
   with self.assertRaises(sqlite3.IntegrityError):self.a.execute(self.insert,r)
 def test_attachment_requires_case_and_scan(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute('INSERT INTO ai3_appeal_attachment_hash VALUES(?,?,?,?)',(CASE,1,HASH,1))
  self.a.execute(self.insert,self.row)
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute('INSERT INTO ai3_appeal_attachment_hash VALUES(?,?,?,?)',(CASE,1,HASH,0))
  self.a.execute('INSERT INTO ai3_appeal_attachment_hash VALUES(?,?,?,?)',(CASE,1,HASH,1))
 def test_append_only_case_event(self):
  self.a.execute(self.insert,self.row)
  self.a.execute('INSERT INTO ai3_appeal_event VALUES(?,?,?,?)',(CASE,1,'RECEIVED',1000))
  with self.assertRaises(sqlite3.IntegrityError):self.a.execute('DELETE FROM ai3_appeal_event')
  with self.assertRaises(sqlite3.IntegrityError):self.a.execute("UPDATE ai3_appeal_event SET event_code='CLOSED'")
 def test_no_private_columns_or_plain_secret(self):
  for table in ['ai3_appeal_case','ai3_appeal_attachment_hash','ai3_appeal_event']:
   cols={r[1].lower() for r in self.a.execute('PRAGMA table_info('+table+')')}
   for x in ['oauth_subject','email','raw_token','jwt','file_bytes','ip','s_user_id']:
    self.assertNotIn(x,cols)
if __name__=='__main__':unittest.main()
