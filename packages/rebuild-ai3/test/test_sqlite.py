"""AI-3 draft SQL tested in SQLite :memory: ONLY. No live D1 or Queue."""
import sqlite3,unittest,pathlib
SQL=(pathlib.Path(__file__).parent.parent/'schema'/'0001_audit_DRAFT.sql').read_text()
class AuditTests(unittest.TestCase):
 def setUp(self):
  self.conn=sqlite3.connect(':memory:')
  self.conn.executescript(SQL)
  self.row=['starry','starry-id','staging','key_1','event_1','identity.session.revoked','digest_1','pending',0]
  self.insert='INSERT INTO ai3_delivery_inbox VALUES(?,?,?,?,?,?,?,?,?)'
 def test_duplicate_claim_and_conflicting_digest(self):
  self.conn.execute(self.insert,self.row)
  for i,v in [(6,'different_digest'),(5,'identity.member.deleted')]:
   r=self.row.copy();r[i]=v
   with self.assertRaises(sqlite3.IntegrityError):self.conn.execute(self.insert,r)
  self.assertEqual(self.conn.execute('SELECT canonical_digest FROM ai3_delivery_inbox').fetchone()[0],'digest_1')
 def test_duplicate_event_id_with_new_key_rejected(self):
  self.conn.execute(self.insert,self.row)
  r=self.row.copy();r[3]='new_key'
  with self.assertRaises(sqlite3.IntegrityError):self.conn.execute(self.insert,r)
 def test_cross_brand_invalid_environment_and_attempt_denied(self):
  for i,v in [(0,'hglobal'),(2,'sandbox'),(8,6),(7,'bad-state')]:
   r=self.row.copy();r[i]=v
   with self.assertRaises(sqlite3.IntegrityError):self.conn.execute(self.insert,r)
 def test_audit_is_append_only_and_has_no_raw_personal_columns(self):
  columns={r[1] for r in self.conn.execute('PRAGMA table_info(ai3_audit_metadata)')}
  for x in ['email','phone','access_token','before_value','after_value','raw_payload','secret']:
   self.assertNotIn(x,columns)
  row=['event_1','starry','starry-id','staging','identity.session.revoked',
    'rebuild-ai3.0.1-candidate','2026-10-26T11:00:00+08:00','corr_1',
    'anon_1','service_1','recorded','metadata_only']
  self.conn.execute('INSERT INTO ai3_audit_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',row)
  with self.assertRaises(sqlite3.IntegrityError):
   self.conn.execute("UPDATE ai3_audit_metadata SET result='denied'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.conn.execute('DELETE FROM ai3_audit_metadata')
 def test_atomic_claim_plus_audit_rollback(self):
  audit=['event_1','starry','starry-id','staging','identity.session.revoked',
    'rebuild-ai3.0.1-candidate','2026-10-26T11:00:00+08:00','corr_1',
    'anon_1','service_1','recorded','metadata_only']
  with self.conn:
   self.conn.execute(self.insert,self.row)
   self.conn.execute('INSERT INTO ai3_audit_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',audit)
  before=self.conn.execute('SELECT COUNT(*) FROM ai3_audit_metadata').fetchone()[0]
  with self.assertRaises(sqlite3.IntegrityError):
   with self.conn:
    self.conn.execute(self.insert,self.row)
    self.conn.execute('INSERT INTO ai3_audit_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',audit)
  self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM ai3_audit_metadata').fetchone()[0],before)
 def test_different_starrry_app_keys_are_isolated(self):
  self.conn.execute(self.insert,self.row)
  r=self.row.copy();r[1]='other-app';r[4]='event_2';self.conn.execute(self.insert,r)
  self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM ai3_delivery_inbox').fetchone()[0],2)
if __name__=='__main__':unittest.main()
