"""Round4 exactly-the-same TS SQL string executed against sqlite3 :memory:.
No remote D1, Queue, Cloudflare, API keys or real purchases.
"""
import ast
import re
import sqlite3
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BASE=(ROOT/'schema/0001_billing_rebuild.DRAFT.sql').read_text()
MIGRATION=(ROOT/'schema/0004_billing_atomic_DRAFT.sql').read_text()
TS=(ROOT/'src/billing-d1.ts').read_text()
KEY='b_'+'a'*64
D='b'*64
NOW='2026-10-26T09:00:00.000Z'
OWNER='o_'+'c'*64
BIND='d'*64
OREF='e'*64
TREF='f'*64
PREF='9'*64
P05='{"brand_id":"starry","app_id":"starry.test","environment":"staging","schema_version":"billing.p05.v1-candidate","event_id":"%s","event_type":"billing.store_state_observed","occurred_at":"2026-10-26T08:00:00Z","correlation_id":"%s","idempotency_key":"%s","actor_ref":"actor_opaque","resource_ref":"%s","result":"recorded","classification":"metadata_only"}' %(KEY,KEY,KEY,KEY)

def sql_from_typescript():
    found={}
    for kind,body in re.findall(r"(owner|event|entitlement|outbox|guard):\[(.*?)\]\.join\(' '\)",TS,re.S):
        parts=re.findall(r"'(?:[^'\\]|\\.)*'",body)
        found[kind]=' '.join(ast.literal_eval(x) for x in parts)
    assert set(found)=={'owner','event','entitlement','outbox','guard'},str(found)
    return found

SQL=sql_from_typescript()
class BillingD1BatchTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(BASE+MIGRATION)
    def tearDown(self):self.db.close()
    def execute_batch(self,*,owner='s_001',expected_version=0,digest=D,
                      bad_outbox=False,wrong_owner=False,previous=False):
        def run():
            self.db.execute(SQL['owner'],(OWNER,'starry','starry.test','staging','sandbox',
                'apple','phd.starry.test',OREF,'s_other' if wrong_owner else owner,BIND,NOW))
            self.db.execute(SQL['event'],(KEY,OWNER,owner,BIND,'starry','starry.test','staging',
                'sandbox','apple','phd.starry.test',PREF,digest,TREF,
                'test.monthly','PAID','2026-10-26T08:00:00Z',NOW))
            self.db.execute(SQL['entitlement'],(OWNER,'test.monthly',owner,'starry.test','active',
                '2026-10-26T08:00:00Z','2026-10-26T08:00:00Z',TREF,'2026-11-26T08:00:00Z',
                KEY,expected_version))
            self.db.execute(SQL['outbox'],(KEY,'WRONG' if bad_outbox else 'billing.store_state_observed',
                'starry.test','staging','sandbox',P05,NOW))
            self.db.execute(SQL['guard'],(KEY,OWNER,'test.monthly',owner,'starry.test',
                expected_version+1 if previous else 1,KEY,KEY,digest,KEY,NOW))
        with self.db:
            run()
    def count(self,table):
        return self.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]
    def test_sql_generated_from_ts_is_prepared_and_executes(self):
        self.execute_batch()
        for table in ('billing_owner','billing_event','billing_entitlement','billing_outbox','billing_atomic_receipt'):
            self.assertEqual(self.count(table),1,table)
        ref=self.db.execute('SELECT safe_payload_json FROM billing_outbox').fetchone()[0]
        self.assertNotIn('RAW_TOKEN',ref)
        self.assertEqual(ref,P05)
    def test_bad_outbox_rolls_back_owner_event_rights_and_receipt(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.execute_batch(bad_outbox=True)
        for t in ('billing_owner','billing_event','billing_entitlement','billing_outbox','billing_atomic_receipt'):
            self.assertEqual(self.count(t),0,t)
    def test_stale_entitlement_cas_forces_guard_constraint_rollback(self):
        self.db.execute('INSERT INTO billing_owner VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (OWNER,'starry','starry.test','staging','sandbox','apple','phd.starry.test',
             OREF,'s_001',BIND,NOW))
        self.db.execute('INSERT INTO billing_entitlement (owner_key,entitlement_key,s_user_id,app_id,status,period_started_at,last_effective_at,last_transaction_ref,valid_until,version,applied_event_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (OWNER,'test.monthly','s_001','starry.test','active','2026-10-26T08:00:00Z',
            '2026-10-26T08:00:00Z',TREF,'2026-11-26T08:00:00Z',4,'prior-event'))
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.execute_batch(expected_version=1,previous=True)
        self.assertEqual(self.count('billing_event'),0)
        self.assertEqual(self.count('billing_outbox'),0)
        self.assertEqual(self.count('billing_atomic_receipt'),0)
        self.assertEqual(self.db.execute('SELECT version FROM billing_entitlement').fetchone()[0],4)
    def test_original_owner_cross_account_hijack_fails_all_writes(self):
        self.db.execute('INSERT INTO billing_owner VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (OWNER,'starry','starry.test','staging','sandbox','apple','phd.starry.test',
             OREF,'s_attacker',BIND,NOW))
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.execute_batch(owner='s_001')
        self.assertEqual(self.count('billing_event'),0)
        self.assertEqual(self.count('billing_outbox'),0)
    def test_duplicate_replay_different_payload_is_rejected(self):
        self.execute_batch()
        self.assertEqual(self.count('billing_event'),1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.execute_batch(digest='0'*64)
        self.assertEqual(self.count('billing_outbox'),1)
        self.assertEqual(self.db.execute('SELECT payload_digest FROM billing_event').fetchone()[0],D)
    def test_scope_store_and_battery_constraints(self):
        self.execute_batch()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO billing_event VALUES (?,?,?,?,?,?,?,?,?)",
                ('b_'+'f'*64,OWNER,'evt-new',D,TREF,'battery.credit','PAID',NOW,NOW))
        self.assertEqual(self.count('billing_event'),1)
    def test_guard_will_never_commit_without_matching_entitlement_event(self):
        self.db.execute('INSERT INTO billing_owner VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (OWNER,'starry','starry.test','staging','sandbox','apple','phd.starry.test',
             OREF,'s_001',BIND,NOW))
        self.db.execute('INSERT INTO billing_event VALUES (?,?,?,?,?,?,?,?,?)',
            (KEY,OWNER,PREF,D,TREF,'test.monthly','PAID',NOW,NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(SQL['guard'],(KEY,OWNER,'test.monthly','s_001','starry.test',
                1,KEY,KEY,D,KEY,NOW))
        self.assertEqual(self.count('billing_atomic_receipt'),0)

if __name__=='__main__':unittest.main()
