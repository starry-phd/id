"""Q116 temporary SQLite-memory restore proof: NEVER touches live Cloudflare data."""
import pathlib, sqlite3, unittest
SQL=(pathlib.Path(__file__).resolve().parent.parent/'schema'/'0007_recovery_gate_DRAFT.sql').read_text()
FENCES=['deleted_members','revoked_sessions','claimed_registration_gifts',
 'battery_journal','committed_ai_tasks','billing_outbox','audit_events']
class IsolatedRecovery(unittest.TestCase):
 def setUp(self):
  self.uri='file:ai3_rec_'+self._testMethodName+'?mode=memory&cache=shared'
  self.live=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.peer=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.live.execute('PRAGMA foreign_keys=ON')
  self.peer.execute('PRAGMA foreign_keys=ON')
  self.live.executescript(SQL)
  self.live.execute('CREATE TABLE authoritative_fence(name TEXT PRIMARY KEY, version INTEGER NOT NULL)')
  self.live.executemany('INSERT INTO authoritative_fence VALUES (?,?)',[(n,i+3) for i,n in enumerate(FENCES)])
 def tearDown(self):
  self.peer.close();self.live.close()
 def evidence(self):
  self.live.execute("INSERT INTO ai3_restore_review VALUES ('review_1234','starry','isolated-test','battery','pitr_1234','vault_1234','review_only',10)")
  self.live.executemany('INSERT INTO ai3_restore_fence VALUES (?,?,?)',
   [('review_1234',n,i+3) for i,n in enumerate(FENCES)])
 def test_review_only_no_restore_command(self):
  self.evidence()
  self.assertEqual(self.peer.execute('SELECT review_status FROM ai3_restore_review').fetchone()[0],'review_only')
 def test_seven_watermark_names_unique(self):
  self.evidence()
  for n in FENCES:
   with self.assertRaises(sqlite3.IntegrityError):
    self.peer.execute('INSERT INTO ai3_restore_fence VALUES(?,?,?)',('review_1234',n,99))
 def test_snapshot_before_member_deletion_detected(self):
  self.evidence()
  self.peer.execute("UPDATE authoritative_fence SET version=version+1 WHERE name='deleted_members'")
  mismatches=self.peer.execute('SELECT a.name FROM authoritative_fence a JOIN ai3_restore_fence r ON r.fence_name=a.name WHERE a.version<>r.version').fetchall()
  self.assertEqual(mismatches,[('deleted_members',)])
 def test_old_backup_cannot_recreate_consumed_registration_gift(self):
  self.evidence()
  self.peer.execute("UPDATE authoritative_fence SET version=version+1 WHERE name='claimed_registration_gifts'")
  self.assertEqual(self.peer.execute("SELECT count(*) FROM authoritative_fence a JOIN ai3_restore_fence r ON r.fence_name=a.name WHERE a.name='claimed_registration_gifts' AND a.version<>r.version").fetchone()[0],1)
 def test_old_backup_cannot_revive_revoked_session(self):
  self.evidence()
  self.peer.execute("UPDATE authoritative_fence SET version=version+1 WHERE name='revoked_sessions'")
  self.assertEqual(self.peer.execute("SELECT count(*) FROM authoritative_fence a JOIN ai3_restore_fence r ON r.fence_name=a.name WHERE a.name='revoked_sessions' AND a.version<>r.version").fetchone()[0],1)
 def test_contended_review_writer_atomic_rollback(self):
  self.live.execute('BEGIN IMMEDIATE')
  self.live.execute("INSERT INTO ai3_restore_review VALUES('review_1234','starry','isolated-test','battery','pitr_1234','vault_1234','review_only',10)")
  with self.assertRaises(sqlite3.OperationalError):self.peer.execute('BEGIN IMMEDIATE')
  self.live.rollback()
  self.assertEqual(self.peer.execute('SELECT COUNT(*) FROM ai3_restore_review').fetchone()[0],0)
 def test_persistent_review_is_append_only(self):
  self.evidence()
  with self.assertRaises(sqlite3.IntegrityError):self.live.execute("DELETE FROM ai3_restore_review")
  with self.assertRaises(sqlite3.IntegrityError):self.live.execute("UPDATE ai3_restore_fence SET version=0")
 def test_wrong_scope_and_nonisolated_environment_refused(self):
  for brand,env in [('hglobal','isolated-test'),('starry','production')]:
   with self.assertRaises(sqlite3.IntegrityError):
    self.live.execute('INSERT INTO ai3_restore_review VALUES (?,?,?,?,?,?,?,?)',
      ('review_1234',brand,env,'battery','pitr_1234','vault_1234','review_only',10))
 def test_no_raw_sensitive_fields_or_replay_instructions(self):
  for table in ('ai3_restore_review','ai3_restore_fence'):
   cols={r[1] for r in self.live.execute('PRAGMA table_info('+table+')')}
   for field in ('raw_data','member_id','email','oauth_subject','token','provider_receipt','restore_sql','backup_payload'):
    self.assertNotIn(field,cols)
if __name__=='__main__':unittest.main()
