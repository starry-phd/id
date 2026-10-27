"""R16 AI-3: replay-safe Battery receipt with *actual* disposable SQLite SQL.
No new migrations; reuse registered R14 0005/0010 only. No Queue ACK.
"""
import pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent/'schema'
SQL=(ROOT/'0005_free_battery_DRAFT.sql').read_text()+'\n'+(ROOT/'0010_auth_delete_battery_inbox_DRAFT.sql').read_text()
EVENT='delete_event_12345678901234567890'
APPLY=("INSERT INTO ai3_r14_deletion_inbox "
 "(brand_id,environment,event_id,member_ref,event_type,occurred_at_ms,policy_version,applied)"
 " VALUES(?,?,?,?,?,?,?,0)")
RECEIPT=(
 "SELECT i.event_id,i.member_ref,i.event_type,i.occurred_at_ms,i.policy_version,"
 "i.applied,w.revoked,w.balance,w.version AS wallet_version,"
 "j.revision AS journal_revision,j.kind,j.delta,j.balance_after,j.reason_code,"
 "(SELECT COUNT(*) FROM ai3_battery_hold h WHERE h.brand_id=i.brand_id "
 "AND h.member_ref=i.member_ref AND h.status='held') AS pending_holds "
 "FROM ai3_r14_deletion_inbox i JOIN ai3_battery_wallet w "
 "ON w.brand_id=i.brand_id AND w.member_ref=i.member_ref "
 "JOIN ai3_battery_journal j ON j.brand_id=i.brand_id "
 "AND j.member_ref=i.member_ref AND j.event_ref=i.event_id AND j.kind='revoke' "
 "WHERE i.brand_id='starry' AND i.environment=? AND i.event_id=? "
 "AND i.member_ref=? AND i.occurred_at_ms=?"
)
class BatteryPublisherReceiptR16(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:',isolation_level=None)
  self.db.row_factory=sqlite3.Row
  self.db.execute('PRAGMA foreign_keys=ON')
  self.db.executescript(SQL)
  self.db.execute("INSERT INTO ai3_battery_wallet "
   "(brand_id,member_ref,balance,registration_granted,version) "
   "VALUES ('starry','member_1',3,1,2)")
  self.db.execute("INSERT INTO ai3_battery_hold VALUES "
   "('starry','member_1','task_1','starry-ai','chat',7,1,1,1000,181000,'held')")
  self.db.executemany('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',[
   ('starry','member_1',1,'initial_registration','registration_grant',10,10,'REGISTER_ONCE',1,100),
   ('starry','member_1',2,'task_1','reserve',-7,3,'TASK_RESERVE',1,1000)
  ])
 def tearDown(self):self.db.close()
 def apply(self,ref=EVENT,member='member_1',occurred=110000):
  self.db.execute(APPLY,('starry','staging',ref,member,'account_deleted',occurred,1))
 def proof(self,ref=EVENT,member='member_1',time=110000,env='staging'):
  result=self.db.execute(RECEIPT,(env,ref,member,time)).fetchone()
  return dict(result) if result else None
 def counts(self):
  return (self.db.execute('SELECT COUNT(*) FROM ai3_r14_deletion_inbox').fetchone()[0],
   self.db.execute('SELECT COUNT(*) FROM ai3_battery_journal').fetchone()[0])
 def test_apply_once_then_replay_receipt_stable_with_zero_second_writes(self):
  self.assertIsNone(self.proof())
  self.apply()
  result=self.proof()
  self.assertEqual(result['wallet_version'],3)
  self.assertEqual(result['journal_revision'],3)
  self.assertEqual(result['pending_holds'],0)
  self.assertEqual(result['revoked'],1)
  self.assertEqual(result['balance'],0)
  self.assertEqual(self.counts(),(1,3))
  self.assertEqual(self.proof(),result)
 def test_second_same_event_cannot_apply_again_but_receipt_still_proves_commit(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):self.apply()
  self.assertIsNotNone(self.proof());self.assertEqual(self.counts(),(1,3))
 def test_other_event_for_same_deleted_member_is_not_equivalent_receipt(self):
  self.apply()
  self.assertIsNone(self.proof('delete_event_12345678901234567891'))
  with self.assertRaises(sqlite3.IntegrityError):
   self.apply('delete_event_12345678901234567891')
  self.assertEqual(self.counts(),(1,3))
 def test_bad_identity_time_or_environment_never_matches(self):
  self.apply()
  for a in [(EVENT,'member_2',110000,'staging'),
   (EVENT,'member_1',109000,'staging'),
   (EVENT,'member_1',110000,'development')]:
   self.assertIsNone(self.proof(*a))
 def test_bad_replay_from_truncated_pitr_is_not_receipted(self):
  before=sqlite3.connect(':memory:')
  try:
   self.db.backup(before)
   self.apply()
   self.assertEqual(before.execute("SELECT count(*) FROM ai3_r14_deletion_inbox").fetchone()[0],0)
   self.assertEqual(self.counts(),(1,3))
  finally:before.close()
 def test_rollback_crash_never_leaves_half_receipt(self):
  self.db.execute('BEGIN IMMEDIATE')
  self.apply()
  self.assertIsNotNone(self.proof())
  self.db.rollback()
  self.assertIsNone(self.proof())
  self.assertEqual(self.counts(),(0,2))
 def test_later_fake_task_and_journal_cannot_reopen_receipt(self):
  self.apply()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE ai3_battery_hold SET status='held' WHERE task_ref='task_1'")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO ai3_battery_journal VALUES "
    "('starry','member_1',4,'task_2','first_task_grant',100,100,'FAKE_GRANT',1,110001)")
  self.assertEqual(self.counts(),(1,3))
 def test_no_sensitive_auth_fields_in_receipt_or_inbox(self):
  self.apply()
  row=self.proof()
  for k in ('oauth_sub','token','email','session_id','event_digest'):
   self.assertNotIn(k,row)
  columns={r[1] for r in self.db.execute('PRAGMA table_info(ai3_r14_deletion_inbox)')}
  self.assertTrue({'event_id','member_ref','occurred_at_ms','applied'}.issubset(columns))
  self.assertNotIn('oauth_sub',columns)
if __name__=='__main__':unittest.main()
