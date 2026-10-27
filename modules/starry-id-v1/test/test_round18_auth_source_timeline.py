"""R18 real Auth SQLite safety tests: deletion-time revocation and committed provenance.
Only disposable SQLite :memory:, never official D1 migration or Queue ACK.
"""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIME = 1793000000
EVENT = 'starry-delete-' + 'a' * 64

class R18CommittedSource(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', isolation_level=None)
        self.db.execute('PRAGMA foreign_keys=ON')
        for name in (
            '001_starry_identity.DRAFT.sql',
            '007_starry_age_deletion_admin.UP.DRAFT.sql',
            '011_starry_one_use_deletion.UP.DRAFT.sql',
            '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
            '013_starry_deletion_source_immutability.UP.DRAFT.sql',
        ):
            self.db.executescript((ROOT / 'schema' / name).read_text())
        self.db.executescript((ROOT / 'test/fixtures/round16_auth_dispatch_lease.DRAFT.sql').read_text())
        self.db.execute("INSERT INTO starry_members VALUES('u1','active',3,1,'name',1,1,?,?)",(TIME,TIME))
        for s, app, digest in (('s1','app-a','a'*64),('s2','app-b','b'*64)):
            self.db.execute("""INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,
                auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (s,'u1',app,'staging',3,digest,TIME+180,
                 'passkey' if s=='s1' else None,
                 TIME-5 if s=='s1' else None,
                 TIME+90 if s=='s1' else None))
    def tearDown(self):
        self.db.close()
    def commit_deletion(self):
        self.db.execute('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)',
                        ('a'*64,'u1','s1',3,EVENT,TIME,TIME+60))
        self.assertEqual(self.db.execute('UPDATE starry_deletion_challenges SET consumed_at=? '
                          'WHERE challenge_ref=? AND consumed_at IS NULL',(TIME,'a'*64)).rowcount,1)
    def unsafe_count(self):
        return self.db.execute("""SELECT COUNT(*) FROM starry_sessions s JOIN
            starry_deletion_outbox o ON o.s_user_id=s.s_user_id
            WHERE o.event_id=? AND (s.revoked_at IS NULL OR s.revoked_at>o.occurred_at)""",
            (EVENT,)).fetchone()[0]
    def test_exact_commit_revokes_sessions_across_two_apps(self):
        self.commit_deletion()
        self.assertEqual(self.unsafe_count(),0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM starry_sessions WHERE revoked_at IS NOT NULL").fetchone()[0],2)
    def test_late_revocation_denied_even_if_all_sessions_currently_revoked(self):
        self.commit_deletion()
        self.db.execute("UPDATE starry_sessions SET revoked_at=? WHERE session_id='s2'",(TIME+1,))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_sessions WHERE revoked_at IS NULL').fetchone()[0],0)
        self.assertEqual(self.unsafe_count(),1)
    def test_new_renegade_session_is_detected(self):
        self.commit_deletion()
        self.db.execute("""INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,
            refresh_hash,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?)""",
            ('s3','u1','app-c','staging',4,'c'*64,TIME+200,None))
        self.assertEqual(self.unsafe_count(),1)
    def test_source_transaction_rollback_not_committed(self):
        self.db.execute('BEGIN IMMEDIATE')
        self.commit_deletion()
        self.db.execute('ROLLBACK')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT status FROM starry_members WHERE s_user_id='u1'").fetchone()[0],'active')
    def test_raw_uncommitted_fake_source_rejected_by_trigger(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO starry_deletion_outbox VALUES(?,?,?,'account_deleted')",(EVENT,'u1',TIME))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starry_deletion_outbox').fetchone()[0],0)
    def test_original_source_cannot_be_rewritten_for_fake_provenance(self):
        self.commit_deletion()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('UPDATE starry_deletion_outbox SET occurred_at=? WHERE event_id=?',(TIME+1,EVENT))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('DELETE FROM starry_deletion_outbox WHERE event_id=?',(EVENT,))
if __name__ == '__main__':
    unittest.main()
