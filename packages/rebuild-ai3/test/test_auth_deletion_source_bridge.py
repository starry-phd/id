"""R15: actual AI-1 001+007+011+012 Auth SQLite source-to-AI3 contract, no D1."""
import pathlib,sqlite3,unittest
SCHEMA=pathlib.Path(__file__).resolve().parents[2]/'..'/'modules'/'starry-id-v1'/'schema'
SCHEMA=SCHEMA.resolve()
CONTRACT=(
 "SELECT o.event_id,o.s_user_id,o.occurred_at,o.event_type,"
 "m.status,m.auth_version,m.updated_at AS deleted_at,"
 "(SELECT COUNT(*) FROM starry_sessions s WHERE s.s_user_id=o.s_user_id "
 "AND s.revoked_at IS NULL) AS unrevoked_sessions "
 "FROM starry_deletion_outbox o "
 "JOIN starry_members m ON m.s_user_id=o.s_user_id "
 "JOIN starry_deletion_challenges c ON c.event_id=o.event_id AND c.s_user_id=o.s_user_id "
 "JOIN starry_deletion_challenge_scope sc ON sc.challenge_ref=c.challenge_ref "
 "WHERE o.event_id=? AND o.s_user_id=? AND o.occurred_at=? "
 "AND o.event_type='account_deleted' AND m.status='deleted' "
 "AND m.updated_at=o.occurred_at AND m.auth_version=c.auth_version+1 "
 "AND c.consumed_at=o.occurred_at AND sc.environment=? "
 "AND NOT EXISTS(SELECT 1 FROM starry_sessions active "
 "WHERE active.s_user_id=o.s_user_id AND active.revoked_at IS NULL)"
)
EVENT='delete_event_12345678901234567890'
VALUES=(EVENT,'member_1',110,'staging')
class OriginalAuthDeletionBridge(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.row_factory=sqlite3.Row
  self.db.execute('PRAGMA foreign_keys=ON')
  for name in ['001_starry_identity.DRAFT.sql','007_starry_age_deletion_admin.UP.DRAFT.sql',
   '011_starry_one_use_deletion.UP.DRAFT.sql','012_starry_stepup_challenge_scope.UP.DRAFT.sql']:
   self.db.executescript((SCHEMA/name).read_text())
  self.db.execute("INSERT INTO starry_members(s_user_id,created_at,updated_at) VALUES('member_1',10,10)")
  self.db.execute("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,"
   "auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at)"
   "VALUES('session_1','member_1','starry-ai','staging',1,'opaque_hash_1',600,'passkey',100,600)")
  self.db.execute("INSERT INTO starry_deletion_challenges"
   "(challenge_ref,s_user_id,session_id,auth_version,event_id,created_at,expires_at)"
   "VALUES(?,?,?,?,?,?,?)",('a'*64,'member_1','session_1',1,EVENT,100,200))
 def tearDown(self):self.db.close()
 def consume(self):
  self.db.execute("UPDATE starry_deletion_challenges SET consumed_at=110 WHERE challenge_ref=?",('a'*64,))
 def proof(self,values=VALUES):
  row=self.db.execute(CONTRACT,values).fetchone()
  return dict(row) if row else None
 def test_before_commit_no_authoritative_source_even_with_pending_challenge(self):
  self.assertIsNone(self.proof())
  self.assertEqual(self.db.execute('SELECT count(*) FROM starry_deletion_outbox').fetchone()[0],0)
 def test_real_ai1_one_use_trigger_yields_exact_row_and_current_auth_proof(self):
  self.consume()
  row=self.proof()
  self.assertEqual(row,dict(event_id=EVENT,s_user_id='member_1',occurred_at=110,
   event_type='account_deleted',status='deleted',auth_version=2,
   deleted_at=110,unrevoked_sessions=0))
  self.assertEqual(list(row)[:4],['event_id','s_user_id','occurred_at','event_type'])
 def test_replay_of_one_use_challenge_cannot_generate_second_source(self):
  self.consume()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE starry_deletion_challenges SET consumed_at=111 WHERE challenge_ref=?",('a'*64,))
  self.assertEqual(self.db.execute("SELECT count(*) FROM starry_deletion_outbox").fetchone()[0],1)
 def test_source_event_removed_is_not_proof_even_if_member_stays_deleted(self):
  self.consume()
  self.db.execute("DELETE FROM starry_deletion_outbox WHERE event_id=?",(EVENT,))
  self.assertIsNone(self.proof())
 def test_unrevoked_session_after_deletion_is_not_valid_proof(self):
  self.consume()
  self.db.execute("UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='session_1'")
  self.assertIsNone(self.proof())
 def test_wrong_scope_stale_timestamp_or_event_ref_is_not_proof(self):
  self.consume()
  for altered in [(EVENT,'member_1',110,'development'),
   (EVENT,'member_1',109,'staging'),
   ('fake_event_12345678901234567890','member_1',110,'staging'),
   (EVENT,'member_2',110,'staging')]:
   self.assertIsNone(self.proof(altered))
 def test_changed_auth_version_after_delete_refuses_stale_event(self):
  self.consume()
  self.db.execute("UPDATE starry_members SET auth_version=auth_version+1 WHERE s_user_id='member_1'")
  self.assertIsNone(self.proof())
 def test_forged_late_outbox_time_refused_even_with_same_row_count(self):
  self.consume()
  self.db.execute("UPDATE starry_deletion_outbox SET occurred_at=112 WHERE event_id=?",(EVENT,))
  self.assertIsNone(self.proof())
 def test_reopened_or_unconsumed_challenge_refused(self):
  self.consume()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE starry_deletion_challenges SET consumed_at=NULL WHERE challenge_ref=?",('a'*64,))
  self.assertIsNotNone(self.proof())
 def test_private_oauth_session_challenge_material_not_selected(self):
  self.consume()
  row=self.proof()
  for field in ['refresh_hash','subject','provider','challenge_ref','step_up_method',
   'session_id','email','access_token','event_digest']:
   self.assertNotIn(field,row)
if __name__=='__main__':unittest.main()
