"""R7 SQLite :memory: only, not production Cloudflare D1 proof."""
import sqlite3,pathlib,unittest
S=(pathlib.Path(__file__).parent.parent/'schema'/'0005_free_battery_DRAFT.sql').read_text()
class BatteryMemory(unittest.TestCase):
 def setUp(self):
  self.uri='file:ai3_bat_'+self._testMethodName+'?mode=memory&cache=shared'
  self.a=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.b=sqlite3.connect(self.uri,uri=True,timeout=0,isolation_level=None)
  self.a.execute('PRAGMA foreign_keys=ON')
  self.b.execute('PRAGMA foreign_keys=ON')
  self.a.executescript(S)
  self.a.execute("INSERT INTO ai3_battery_wallet(brand_id,member_ref,balance,registration_granted) VALUES('starry','m1',10,1)")
  self.hold="INSERT INTO ai3_battery_hold VALUES('starry','m1',?,'starry-ai','chat',7,1,1,1000,181000,'held')"
 def tearDown(self):self.b.close();self.a.close()
 def test_permanent_no_expiry_no_payment_or_PII_columns(self):
  c={x[1] for x in self.a.execute('PRAGMA table_info(ai3_battery_wallet)')}
  for bad in ('expires_at','price_usd','currency','oauth_subject','email','token'):self.assertNotIn(bad,c)
 def test_journal_unique_grant_and_append_only(self):
  x=('starry','m1',1,'register','registration_grant',10,10,'REGISTER_ONCE',1,1000)
  self.a.execute('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',x)
  with self.assertRaises(sqlite3.IntegrityError):self.a.execute('INSERT INTO ai3_battery_journal VALUES(?,?,?,?,?,?,?,?,?,?)',x)
  with self.assertRaises(sqlite3.IntegrityError):self.a.execute('DELETE FROM ai3_battery_journal')
 def test_version_cas_denies_second_concurrent_commit(self):
  self.a.execute("UPDATE ai3_battery_wallet SET balance=3,version=1 WHERE member_ref='m1' AND version=0")
  self.assertEqual(self.b.execute("UPDATE ai3_battery_wallet SET balance=-4,version=2 WHERE member_ref='m1' AND version=0").rowcount,0)
 def test_db_write_lock_and_rollback(self):
  self.a.execute('BEGIN IMMEDIATE')
  try:
   self.a.execute("UPDATE ai3_battery_wallet SET balance=3 WHERE member_ref='m1'")
   with self.assertRaises(sqlite3.OperationalError):self.b.execute('BEGIN IMMEDIATE')
   self.a.rollback()
   self.assertEqual(self.b.execute("SELECT balance FROM ai3_battery_wallet WHERE member_ref='m1'").fetchone()[0],10)
  finally:self.a.rollback()
 def test_three_minute_boundary_prevents_late_commit(self):
  self.a.execute(self.hold,('t1',))
  self.assertEqual(self.a.execute("UPDATE ai3_battery_hold SET status='committed' WHERE task_ref='t1' AND status='held' AND expires_ms>181000").rowcount,0)
  self.assertEqual(self.a.execute("UPDATE ai3_battery_hold SET status='expired' WHERE task_ref='t1' AND status='held' AND expires_ms<=181000").rowcount,1)
 def test_same_task_ref_cross_app_unique(self):
  self.a.execute(self.hold,('t1',))
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute("INSERT INTO ai3_battery_hold VALUES('starry','m1','t1','other','chat',5,1,1,1000,181000,'held')")
 def test_only_starry_and_at_most_two_overdrafts(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute("INSERT INTO ai3_battery_wallet(brand_id,member_ref) VALUES('hglobal','m2')")
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute("UPDATE ai3_battery_wallet SET overdraft_used=3 WHERE member_ref='m1'")
 def test_deletion_revocation_requires_zero_balance(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.a.execute("UPDATE ai3_battery_wallet SET revoked=1 WHERE member_ref='m1'")
  self.a.execute("UPDATE ai3_battery_wallet SET revoked=1,balance=0 WHERE member_ref='m1'")
 def test_atomic_rollback_of_wallet_and_hold(self):
  self.a.execute('BEGIN IMMEDIATE')
  self.a.execute("UPDATE ai3_battery_wallet SET balance=3,version=1 WHERE member_ref='m1'")
  self.a.execute(self.hold,('t1',))
  self.a.rollback()
  self.assertEqual(self.a.execute("SELECT balance,version FROM ai3_battery_wallet WHERE member_ref='m1'").fetchone(),(10,0))
  self.assertEqual(self.a.execute('SELECT COUNT(*) FROM ai3_battery_hold').fetchone()[0],0)
if __name__=='__main__':unittest.main()
