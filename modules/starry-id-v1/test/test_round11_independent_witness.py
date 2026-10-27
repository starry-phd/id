"""R11 local SQLite :memory: demonstration of independent anti-rollback anchor.
Not an authenticated, durable Cloudflare storage service and NOT a PITR test.
"""
import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'schema'
NOW=1793000000
class SeparateWitnessAnchors(unittest.TestCase):
 def setUp(self):
  self.auth=sqlite3.connect(':memory:',isolation_level=None)
  self.anchor=sqlite3.connect(':memory:',isolation_level=None)
  self.auth.execute('PRAGMA foreign_keys=ON')
  for n in ('001_starry_identity.DRAFT.sql',
            '007_starry_age_deletion_admin.UP.DRAFT.sql',
            '008_starry_first_gift_privacy.UP.DRAFT.sql',
            '010_starry_recovery_auth_fences.UP.DRAFT.sql'):
   self.auth.executescript((ROOT/n).read_text())
  self.auth.execute("INSERT INTO starry_members VALUES('u1','active',1,1,NULL,0,0,?,?)",(NOW,NOW))
  self.anchor.executescript("""
   CREATE TABLE head(environment TEXT PRIMARY KEY,seq INTEGER NOT NULL CHECK(seq>=1),
      digest TEXT NOT NULL CHECK(length(digest)=64));
   CREATE TRIGGER no_rewind BEFORE UPDATE ON head
     WHEN NEW.seq<=OLD.seq BEGIN SELECT RAISE(ABORT,'REPLAY_DENIED');END;
   """)
 def tearDown(self):self.auth.close();self.anchor.close()
 def counters(self):
  return self.auth.execute("SELECT deleted_members,revoked_sessions,claimed_registration_gifts FROM starry_auth_recovery_fence").fetchone()
 def test_authoritative_anchor_survives_auth_transaction_rollback(self):
  self.auth.execute('BEGIN IMMEDIATE')
  self.auth.execute("UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'")
  self.assertEqual(self.counters(),(1,0,0))
  self.anchor.execute("INSERT INTO head VALUES('staging',11,?)",('a'*64,))
  self.auth.execute('ROLLBACK')
  self.assertEqual(self.counters(),(0,0,0))
  self.assertEqual(self.anchor.execute("SELECT seq FROM head").fetchone(),(11,))
  # A signature over the old counters cannot satisfy both current live Auth
  # data and an independent current anchor after a divergent rollback.
 def test_old_sequence_or_same_replay_not_committable_to_separate_anchor(self):
  self.anchor.execute("INSERT INTO head VALUES('staging',11,?)",('a'*64,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.anchor.execute("UPDATE head SET seq=11,digest=? WHERE environment='staging'",('b'*64,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.anchor.execute("UPDATE head SET seq=10,digest=? WHERE environment='staging'",('c'*64,))
  self.anchor.execute("UPDATE head SET seq=12,digest=? WHERE environment='staging'",('d'*64,))
  self.assertEqual(self.anchor.execute("SELECT seq FROM head").fetchone(),(12,))
 def test_sqlite_memory_is_not_persistent_or_trusted_anchor(self):
  self.anchor.execute("INSERT INTO head VALUES('staging',11,?)",('a'*64,))
  self.anchor.close()
  self.anchor=sqlite3.connect(':memory:',isolation_level=None)
  self.assertEqual(self.anchor.execute("SELECT count(*) FROM sqlite_master WHERE name='head'").fetchone()[0],0)
if __name__=='__main__':unittest.main()
