import sqlite3
import unittest
from pathlib import Path

SQL = (Path(__file__).resolve().parent.parent / 'schema' / '0001_billing_rebuild.DRAFT.sql').read_text()
AI3_SQL = (Path(__file__).resolve().parents[2] / 'rebuild-ai3/schema/0001_audit_DRAFT.sql').read_text()

KEY = 'b_' + 'a' * 64
DIGEST = 'b' * 64
TIME = '2026-10-26T08:00:00Z'


class BillingSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(SQL)
        self.insert_owner()

    def tearDown(self):
        self.db.close()

    def insert_owner(self, key='owner-1', user='user-1', original='orig-1', runtime='staging', store_env='sandbox'):
        self.db.execute('INSERT INTO billing_owner VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                        (key, 'starry', 'starry.test', runtime, store_env, 'apple', 'phd.starry.test',
                         original, user, 'c' * 64, TIME))

    def insert_event(self, key=KEY, digest=DIGEST, sku='test.monthly', state='PAID', ref='evt-1'):
        self.db.execute('INSERT INTO billing_event VALUES (?,?,?,?,?,?,?,?,?)',
                        (key, 'owner-1', ref, digest, 'transaction-1', sku, state, TIME, TIME))

    def test_atomic_plan_entitlement_and_outbox(self):
        with self.db:
            self.insert_event()
            self.db.execute('INSERT INTO billing_entitlement VALUES (?,?,?,?,?,?,?,?,?,?)',
                            ('owner-1', 'test.premium', 'user-1', 'starry.test', 'active', TIME,
                             TIME, 'transaction-1', '2026-11-26T08:00:00Z', 1))
            self.db.execute('INSERT INTO billing_outbox (idempotency_key,event_type,app_id,environment,store_environment,safe_payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
                            (KEY, 'billing.store_state_observed', 'starry.test', 'staging', 'sandbox', '{}', TIME))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM billing_event').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM billing_outbox').fetchone()[0], 1)

    def test_first_claim_is_unique_and_cannot_transfer_user(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_owner(key='owner-2', user='alien', original='orig-1')

    def test_store_environment_and_runtime_do_not_mix(self):
        for changed in [{'runtime': 'sandbox'}, {'runtime': 'production'}, {'store_env': 'production'}]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.insert_owner(key='owner-2', original='orig-2', **changed)

    def test_duplicate_provider_id_and_key_rejected(self):
        self.insert_event()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_event(key='b_'+'d'*64, ref='evt-1')
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_event(ref='other-event')

    def test_id_collision_cannot_replace_digest(self):
        self.insert_event()
        self.assertEqual(self.db.execute('SELECT payload_digest FROM billing_event WHERE idempotency_key=?', (KEY,)).fetchone()[0], DIGEST)
        changed_digest='e'*64
        self.assertNotEqual(changed_digest, DIGEST)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_event(digest=changed_digest)

    def test_failed_outbox_insert_rolls_back_event_and_entitlement(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.insert_event()
                self.db.execute('INSERT INTO billing_outbox (idempotency_key,event_type,app_id,environment,store_environment,safe_payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
                                (KEY,'WRONG_EVENT','starry.test','staging','sandbox','{}',TIME))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM billing_event').fetchone()[0], 0)

    def test_entitlement_compare_and_swap(self):
        self.insert_event()
        self.db.execute('INSERT INTO billing_entitlement VALUES (?,?,?,?,?,?,?,?,?,?)',
                        ('owner-1','test.premium','user-1','starry.test','active',TIME,TIME,'transaction-1',None,1))
        update='UPDATE billing_entitlement SET status=?,version=version+1 WHERE owner_key=? AND entitlement_key=? AND version=?'
        first=self.db.execute(update, ('inactive','owner-1','test.premium',1))
        self.assertEqual(first.rowcount,1)
        stale=self.db.execute(update, ('active','owner-1','test.premium',1))
        self.assertEqual(stale.rowcount,0)
        self.assertEqual(self.db.execute('SELECT status FROM billing_entitlement').fetchone()[0],'inactive')

    def test_battery_purchase_and_entitlement_forbidden(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_event(sku='starry.battery')
        self.insert_event()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO billing_entitlement VALUES (?,?,?,?,?,?,?,?,?,?)',
                            ('owner-1','battery.credit','user-1','starry.test','active',TIME,TIME,'transaction-1',None,1))

    def test_orphan_outbox_forbidden(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO billing_outbox (idempotency_key,event_type,app_id,environment,store_environment,safe_payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
                            (KEY,'billing.store_state_observed','starry.test','staging','sandbox','{}',TIME))


    def test_cross_domain_ai3_inbox_scoped_replay_is_unique(self):
        self.db.executescript(AI3_SQL)
        row = ('starry','starry.test','staging',KEY,'evt-1','billing.store_state_observed',DIGEST)
        statement = 'INSERT INTO ai3_delivery_inbox (brand_id,app_id,environment,idempotency_key,event_id,event_type,canonical_digest) VALUES (?,?,?,?,?,?,?)'
        self.db.execute(statement,row)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(statement,row)
        self.db.execute(statement,('starry','starry.other','staging',KEY,'evt-1','billing.store_state_observed',DIGEST))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_delivery_inbox').fetchone()[0],2)

    def test_cross_domain_wrong_audit_schema_version_fails_closed(self):
        self.db.executescript(AI3_SQL)
        statement = """INSERT INTO ai3_audit_metadata
        (event_id,brand_id,app_id,environment,event_type,schema_version,occurred_at,correlation_id,resource_ref,actor_ref,result,classification)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"""
        candidate=(KEY,'starry','starry.test','staging','billing.store_state_observed',
                   'billing.p05.v1-candidate',TIME,KEY,KEY,'opaque_actor_1','recorded','metadata_only')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(statement,candidate)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai3_audit_metadata').fetchone()[0],0)

    def test_cross_domain_inbox_wrong_brand_and_runtime_rejected(self):
        self.db.executescript(AI3_SQL)
        statement = 'INSERT INTO ai3_delivery_inbox (brand_id,app_id,environment,idempotency_key,event_id,event_type,canonical_digest) VALUES (?,?,?,?,?,?,?)'
        for row in [('hglobal','starry.test','staging',KEY,'evt','billing.store_state_observed',DIGEST),
                    ('starry','starry.test','sandbox',KEY,'evt','billing.store_state_observed',DIGEST)]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(statement,row)

    def test_mock_single_db_billing_event_outbox_inbox_atomic_rollback(self):
        # In-memory ONE physical SQLite connection only; this does not prove cross-D1 transactions.
        self.db.executescript(AI3_SQL)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.insert_event()
                self.db.execute('INSERT INTO billing_outbox (idempotency_key,event_type,app_id,environment,store_environment,safe_payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
                                (KEY,'billing.store_state_observed','starry.test','staging','sandbox','{}',TIME))
                self.db.execute('INSERT INTO ai3_delivery_inbox (brand_id,app_id,environment,idempotency_key,event_id,event_type,canonical_digest) VALUES (?,?,?,?,?,?,?)',
                                ('starry','starry.test','staging',KEY,'evt-1','billing.store_state_observed',DIGEST))
                # Same sender key but incompatible P05 version must not yield a committed partial event.
                self.db.execute('INSERT INTO ai3_audit_metadata VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                                (KEY,'starry','starry.test','staging','billing.store_state_observed',
                                 'billing.p05.v1-candidate',TIME,KEY,KEY,'opaque_actor_1','recorded','metadata_only'))
        for table in ['billing_event','billing_outbox','ai3_delivery_inbox','ai3_audit_metadata']:
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)

    def test_old_period_refund_cannot_overwrite_new_renewal_in_mock_cas(self):
        self.insert_event()
        self.db.execute('INSERT INTO billing_entitlement VALUES (?,?,?,?,?,?,?,?,?,?)',
                        ('owner-1','test.premium','user-1','starry.test','active',
                         '2026-11-26T08:00:00Z','2026-11-26T08:00:00Z','transaction-2',
                         '2026-12-26T08:00:00Z',2))
        # The future Billing D1 writer must preserve this conditional guard plus version CAS.
        n=self.db.execute("""UPDATE billing_entitlement SET status='inactive',version=version+1
          WHERE owner_key=? AND entitlement_key=? AND version=?
            AND period_started_at <= ? AND last_effective_at <= ?""",
          ('owner-1','test.premium',2,'2026-10-26T08:00:00Z','2026-10-27T08:00:00Z')).rowcount
        self.assertEqual(n,0)
        self.assertEqual(self.db.execute('SELECT status FROM billing_entitlement').fetchone()[0],'active')


if __name__ == '__main__':
    unittest.main()
