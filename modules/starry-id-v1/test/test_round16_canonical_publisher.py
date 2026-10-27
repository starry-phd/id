"""R16: real SQLite Auth outbox + durable lease + separate consumer DB dedup.

This tests a candidate, NOT a real Cloudflare D1/Queue delivery protocol.
The SQL schema is an offline fixture, not migration authorization.
"""
import sqlite3,unittest,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
SCHEMA=ROOT/'schema'
N=1793000000
EVENT='starry-delete-'+'a'*64
CLAIM=(
 'INSERT INTO starry_auth_deletion_dispatch_claims '
 '(event_id,publisher_id,lease_token,lease_expires_at,attempt_no) '
 "SELECT o.event_id,'starry-auth-sole-v1',?,?,1 "
 'FROM starry_deletion_outbox o '
 'JOIN starry_members m ON m.s_user_id=o.s_user_id '
 'JOIN starry_deletion_challenges c ON c.event_id=o.event_id '
 'AND c.s_user_id=o.s_user_id AND c.consumed_at=o.occurred_at '
 'JOIN starry_deletion_challenge_scope z ON z.challenge_ref=c.challenge_ref '
 "WHERE o.event_id=? AND o.event_type='account_deleted' "
 'AND z.environment=? AND o.occurred_at<=? AND o.occurred_at>=0 '
 "AND m.status='deleted' AND m.auth_version=c.auth_version+1 "
 'AND m.updated_at=o.occurred_at AND m.display_name IS NULL '
 'AND m.directory_opt_in=0 AND m.display_name_public=0 '
 'AND length(o.s_user_id)<=96 '
 'AND NOT EXISTS(SELECT 1 FROM starry_sessions s '
 'WHERE s.s_user_id=m.s_user_id AND s.revoked_at IS NULL) '
 'ON CONFLICT(event_id) DO UPDATE SET '
 'lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,'
 'attempt_no=starry_auth_deletion_dispatch_claims.attempt_no+1 '
 "WHERE starry_auth_deletion_dispatch_claims.publisher_id='starry-auth-sole-v1' "
 'AND starry_auth_deletion_dispatch_claims.lease_expires_at<=? '
 'AND starry_auth_deletion_dispatch_claims.attempt_no<1000 '
 'RETURNING event_id,publisher_id,lease_token,lease_expires_at,attempt_no'
)
class SoleSourceLease(unittest.TestCase):
 def setUp(self):
  self.auth=sqlite3.connect(':memory:',isolation_level=None)
  self.battery=sqlite3.connect(':memory:',isolation_level=None)
  self.auth.execute('PRAGMA foreign_keys=ON')
  for name in ('001_starry_identity.DRAFT.sql','007_starry_age_deletion_admin.UP.DRAFT.sql',
   '011_starry_one_use_deletion.UP.DRAFT.sql','012_starry_stepup_challenge_scope.UP.DRAFT.sql',
   '013_starry_deletion_source_immutability.UP.DRAFT.sql'):
   self.auth.executescript((SCHEMA/name).read_text())
  self.auth.executescript((ROOT/'test/fixtures/round16_auth_dispatch_lease.DRAFT.sql').read_text())
  self.auth.execute("INSERT INTO starry_members VALUES('u1','active',3,1,'name',1,1,?,?)",(N,N))
  self.auth.executemany("""INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,
    auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)""",[
     ('sid1','u1','app-a','staging',3,'a'*64,N+120,'passkey',N-5,N+90),
     ('sid2','u1','app-b','staging',3,'b'*64,N+120,None,None,None)])
  self.battery.executescript("""CREATE TABLE deletion_inbox(event_id TEXT PRIMARY KEY,member_ref TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type='account_deleted'));
    CREATE TABLE wallet(member_ref TEXT PRIMARY KEY,revoked INTEGER NOT NULL DEFAULT 0,
      revoke_count INTEGER NOT NULL DEFAULT 0);
    INSERT INTO wallet VALUES('u1',0,0);
    CREATE TRIGGER revoke_once AFTER INSERT ON deletion_inbox BEGIN
      UPDATE wallet SET revoked=1,revoke_count=revoke_count+1
      WHERE member_ref=NEW.member_ref AND revoked=0;
    END;""")
 def tearDown(self):self.auth.close();self.battery.close()
 def delete(self):
  self.auth.execute('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)',
   ('a'*64,'u1','sid1',3,EVENT,N,N+60))
  self.assertEqual(self.auth.execute(
   "UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL",
   (N,'a'*64)).rowcount,1)
 def claim(self,now=N,token='b'*64,env='staging'):
  return self.auth.execute(CLAIM,(token,now+30,EVENT,env,now,now)).fetchone()
 def sink(self):
  row=self.auth.execute("SELECT event_id,s_user_id,event_type FROM starry_deletion_outbox WHERE event_id=?",(EVENT,)).fetchone()
  self.battery.execute('INSERT OR IGNORE INTO deletion_inbox VALUES(?,?,?)',(row[0],row[1],row[2]))
 def test_no_event_before_commit_and_one_active_lease(self):
  self.assertIsNone(self.claim())
  self.delete()
  self.assertEqual(self.claim(),(EVENT,'starry-auth-sole-v1','b'*64,N+30,1))
  self.assertIsNone(self.claim(N+10,'c'*64))
  self.assertEqual(self.claim(N+30,'d'*64),(EVENT,'starry-auth-sole-v1','d'*64,N+60,2))
 def test_crash_replay_across_two_independent_dbs_never_revokes_twice(self):
  self.delete()
  self.claim()
  # Transmission succeeds but caller crashes before observing consumer receipt.
  self.sink()
  # Lease expires; same immutable original event id retried.
  self.claim(N+31,'c'*64)
  self.sink()
  self.assertEqual(self.battery.execute('SELECT COUNT(*) FROM deletion_inbox').fetchone()[0],1)
  self.assertEqual(self.battery.execute("SELECT revoked,revoke_count FROM wallet").fetchone(),(1,1))
  self.assertEqual(self.auth.execute('SELECT attempt_no FROM starry_auth_deletion_dispatch_claims').fetchone(),(2,))
 def test_foreign_scope_and_raw_fake_row_and_alive_member_all_refused(self):
  self.delete()
  self.assertIsNone(self.claim(env='development'))
  with self.assertRaises(sqlite3.IntegrityError):
   self.auth.execute("INSERT INTO starry_auth_deletion_dispatch_claims VALUES(?,?,?,?,?)",
    (EVENT,'another-publisher','f'*64,N+30,1))
 def test_outbox_source_immutability_and_lease_no_delete(self):
  self.delete();self.claim()
  with self.assertRaises(sqlite3.IntegrityError):
   self.auth.execute('DELETE FROM starry_auth_deletion_dispatch_claims')
  with self.assertRaises(sqlite3.IntegrityError):
   self.auth.execute("UPDATE starry_deletion_outbox SET occurred_at=? WHERE event_id=?",(N+1,EVENT))
  with self.assertRaises(sqlite3.IntegrityError):
   self.auth.execute("UPDATE starry_auth_deletion_dispatch_claims SET attempt_no=55")
 def test_revoked_member_event_is_one_transaction_and_rollback_drops_lease(self):
  self.auth.execute('BEGIN IMMEDIATE')
  self.delete();self.claim()
  self.assertEqual(self.auth.execute('SELECT COUNT(*) FROM starry_auth_deletion_dispatch_claims').fetchone()[0],1)
  self.auth.execute('ROLLBACK')
  self.assertEqual(self.auth.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],0)
  self.assertEqual(self.auth.execute('SELECT COUNT(*) FROM starry_auth_deletion_dispatch_claims').fetchone()[0],0)
 def test_disjoint_sink_db_cannot_be_assumed_atomic_with_auth_lease(self):
  self.delete();self.claim()
  self.battery.execute('BEGIN IMMEDIATE')
  self.sink()
  self.battery.execute('ROLLBACK')
  self.assertEqual(self.auth.execute('SELECT COUNT(*) FROM starry_auth_deletion_dispatch_claims').fetchone()[0],1)
  self.assertEqual(self.battery.execute('SELECT COUNT(*) FROM deletion_inbox').fetchone()[0],0)
  # Delivery remains unacknowledged; after 30s retry is possible.
  self.assertEqual(self.claim(N+31,'e'*64)[-1],2)
if __name__=='__main__':unittest.main()
