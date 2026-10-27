"""R12 Audit event append-only/rollback/witness boundaries: disposable SQLite only."""
import pathlib,sqlite3,unittest
SCHEMA=(pathlib.Path(__file__).resolve().parent.parent/'schema'/'0009_signed_audit_recovery_DRAFT.sql').read_text()
class AuditWitnessMemory(unittest.TestCase):
 def setUp(self):
  self.a=sqlite3.connect(':memory:',isolation_level=None)
  self.a.executescript(SCHEMA)
  self.row=lambda seq,ref:('starry','staging',seq,'a_'+ref*64,'important_management',
   'ADMIN_ACTION',seq*100,1,'ref_'+'b'*32,'ADMIN_REVIEW')
  self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',self.row(1,'a'))
 def tearDown(self):self.a.close()
 def test_first_event_persisted(self):
  self.assertEqual(self.a.execute('SELECT seq FROM ai3_r12_audit_events').fetchall(),[(1,)])
 def test_same_seq_conflict_prevents_replaying(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',self.row(1,'c'))
 def test_duplicate_event_ref_refused(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',self.row(2,'a'))
 def test_cross_brand_denied(self):
  r=list(self.row(2,'c'));r[0]='hglobal'
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',r)
 def test_production_denied(self):
  r=list(self.row(2,'c'));r[1]='production'
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',r)
 def test_triggers_prevent_update_and_delete(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute("UPDATE ai3_r12_audit_events SET decision_code='FALSE' WHERE seq=1")
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute('DELETE FROM ai3_r12_audit_events WHERE seq=1')
 def test_atomic_rollback_of_append(self):
  self.a.execute('BEGIN IMMEDIATE')
  self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',self.row(2,'c'))
  self.a.rollback()
  self.assertEqual(self.a.execute('SELECT COUNT(*) FROM ai3_r12_audit_events').fetchone()[0],1)
 def test_pitr_old_snapshot_loses_later_append(self):
  old=sqlite3.connect(':memory:')
  try:
   self.a.backup(old)
   self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',self.row(2,'c'))
   self.assertEqual(old.execute('SELECT COUNT(*) FROM ai3_r12_audit_events').fetchone()[0],1)
   self.assertEqual(self.a.execute('SELECT COUNT(*) FROM ai3_r12_audit_events').fetchone()[0],2)
  finally:old.close()
 def test_raw_sensitive_fields_not_stored(self):
  names={x[1] for x in self.a.execute('PRAGMA table_info(ai3_r12_audit_events)')}
  for bad in ['raw_oauth_sub','email','ip','password','access_token','payment_token','backup_payload']:
   self.assertNotIn(bad,names)
 def test_wrong_classification_and_event_code_denied(self):
  for idx,v in [(4,'false'),(5,'TRANSFER_MONEY')]:
   r=list(self.row(2,'c'));r[idx]=v
   with self.assertRaises(sqlite3.IntegrityError):
    self.a.execute('INSERT INTO ai3_r12_audit_events VALUES(?,?,?,?,?,?,?,?,?,?)',r)
if __name__=='__main__':unittest.main()
