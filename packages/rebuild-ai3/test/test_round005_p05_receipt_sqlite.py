"""AI-3 R005 executable disposable sqlite3 :memory: recovery / CAS negative suite."""
import importlib.util
from dataclasses import replace
from pathlib import Path
import sqlite3
import sys
import unittest

SRC = Path(__file__).resolve().parents[1] / "src" / "wave1_r005_p05_sqlite_cas.py"
SPEC = importlib.util.spec_from_file_location("wave1_r005_p05_sqlite_cas", SRC)
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)

def event(**kwargs):
    e = mod.FixtureEvent(app_id="starry-id", environment="staging",
        event_id="evt_000001", idempotency_key="idem_000001",
        nonce="nonce_12345678", digest="a" * 64, actor_ref="actor_000001")
    return replace(e, **kwargs)

def fence(e=None, **kwargs):
    e = e or event()
    f = mod.FixtureFence(event_id=e.event_id, actor_ref=e.actor_ref,
        auth_version=1, session_version=1, state="active",
        legal_policy_version=1, lawful_now=True, erasure_hold="none")
    return replace(f, **kwargs)


class R005SqliteRecovery(unittest.TestCase):
    def setUp(self):
        self.model = mod.OfflineReceiptCasModel()
        self.e = event()
        self.f = fence(self.e)

    def claim(self, e=None, before=None, after=None, failpoint=None):
        e = e or self.e
        before = before or self.f
        after = after or before
        r = self.model.local_claim(e, before, after, failpoint=failpoint)
        self.assert_no_rights(r)
        return r

    def assert_no_rights(self, r):
        for k in ("may_ack", "may_send", "may_enqueue", "may_retry",
            "may_write_real_d1", "may_grant_battery", "may_sell_battery",
            "may_publish", "live"):
            self.assertIs(getattr(r, k), False, k)

    def test_01_contract_versions_and_two_memory_only_connections(self):
        self.assertIn("r005", mod.CONTRACT)
        self.assertIn("r004", mod.PINNED["ai1_auth"])
        self.assertIn("r003", mod.PINNED["ai4_transport"])
        self.assertIsNot(self.model.db, self.model.witness)
        self.assertEqual(self.model.db.execute("PRAGMA database_list").fetchone()[2], "")
        self.assertEqual(self.model.witness.execute("PRAGMA database_list").fetchone()[2], "")

    def test_02_local_sqlite_atomic_claim_and_outbox_is_never_ack(self):
        r = self.claim()
        self.assertEqual((r.status, r.reason, r.local_receipt_persisted),
            ("review_only", "LOCAL_SQLITE_COMMITTED_NOT_D1", True))
        self.assertEqual((self.model.count_claims(), self.model.count_outbox()), (1, 1))

    def test_03_exact_replay_is_duplicate_not_second_claim(self):
        self.claim()
        self.assertEqual(self.claim().reason, "DUPLICATE_LOCAL_CLAIM")
        self.assertEqual((self.model.count_claims(), self.model.count_outbox()), (1, 1))

    def test_04_same_event_changed_digest_denied(self):
        self.claim()
        self.assertEqual(self.claim(e=replace(self.e, digest="b" * 64)).reason,
            "CONFLICTING_LOCAL_CLAIM")
        self.assertEqual(self.model.count_claims(), 1)

    def test_05_same_nonce_second_event_is_conflicting(self):
        self.claim()
        e2 = replace(self.e, event_id="evt_other", idempotency_key="idem_other")
        self.assertEqual(self.claim(e=e2, before=fence(e2)).reason,
            "CONFLICTING_LOCAL_CLAIM")

    def test_06_same_event_different_idempotency_key_denied(self):
        self.claim()
        self.assertEqual(self.claim(e=replace(self.e, idempotency_key="idem_other")).reason,
            "CONFLICTING_LOCAL_CLAIM")

    def test_07_different_apps_and_environments_are_isolated(self):
        self.claim()
        e2 = replace(self.e, app_id="starry-second")
        e3 = replace(self.e, environment="development")
        self.assertEqual(self.claim(e=e2, before=fence(e2)).status, "review_only")
        self.assertEqual(self.claim(e=e3, before=fence(e3)).status, "review_only")
        self.assertEqual((self.model.count_claims(), self.model.count_outbox()), (3, 3))

    def test_08_crash_after_claim_rolls_back_claim_and_outbox(self):
        self.assertEqual(self.claim(failpoint="after_claim").reason,
            "LOCAL_TRANSACTION_ROLLED_BACK")
        self.assertEqual((self.model.count_claims(), self.model.count_outbox()), (0, 0))

    def test_09_crash_after_outbox_rolls_back_both(self):
        self.assertEqual(self.claim(failpoint="after_outbox").reason,
            "LOCAL_TRANSACTION_ROLLED_BACK")
        self.assertEqual((self.model.count_claims(), self.model.count_outbox()), (0, 0))

    def test_10_precommit_crash_and_retry_only_one_commit(self):
        self.assertEqual(self.claim(failpoint="before_commit").status, "blocked")
        self.assertEqual(self.claim().status, "review_only")
        self.assertEqual(self.claim().reason, "DUPLICATE_LOCAL_CLAIM")
        self.assertEqual((self.model.count_claims(), self.model.count_outbox()), (1, 1))

    def test_11_revoked_deleted_unknown_session_cannot_claim_delivery(self):
        for state in ("revoked", "deleted", "unknown"):
            r = self.claim(before=replace(self.f, state=state))
            self.assertEqual(r.reason, "UNTRUSTED_EVENT_SESSION_OR_LAW")
        self.assertEqual(self.model.count_claims(), 0)

    def test_12_event_actor_binding_mismatch_denied(self):
        for bad in (replace(self.f, actor_ref="other_actor"),
                    replace(self.f, event_id="evt_other"),
                    replace(self.f, auth_version=0),
                    replace(self.f, session_version=-1)):
            self.assertEqual(self.claim(before=bad).status, "blocked")
        self.assertEqual(self.model.count_claims(), 0)

    def test_13_late_revocation_between_two_views_denied(self):
        changed = replace(self.f, auth_version=2, session_version=2, state="revoked")
        self.assertEqual(self.claim(after=changed).reason,
            "UNTRUSTED_EVENT_SESSION_OR_LAW")
        self.assertEqual(self.model.count_outbox(), 0)

    def test_14_erasure_audit_only_with_matching_state_and_candidate_hold(self):
        e = replace(self.e, event_type="identity.member.deleted")
        invalid = replace(self.f, state="deleted")
        self.assertEqual(self.claim(e=e, before=invalid).status, "blocked")
        valid = replace(invalid, erasure_hold="active")
        self.assertEqual(self.claim(e=e, before=valid).status, "review_only")
        self.assertEqual(self.model.count_outbox(), 1)

    def test_15_lawful_processing_and_policy_drift_denied(self):
        for bad in (replace(self.f, lawful_now=False),
                    replace(self.f, legal_policy_version=0),
                    replace(self.f, erasure_hold="unapproved"),
                    replace(self.f, issuer_state="signature_verified")):
            self.assertEqual(self.claim(before=bad).status, "blocked")
        self.assertEqual(self.claim(after=replace(self.f, legal_policy_version=2)).status,
            "blocked")
        self.assertEqual(self.model.count_claims(), 0)

    def test_16_bad_scope_production_digest_nonce_and_event_type_denied(self):
        for e in (replace(self.e, brand_id="hglobal"),
                  replace(self.e, environment="production"),
                  replace(self.e, digest="not_sha256"),
                  replace(self.e, nonce="bad"),
                  replace(self.e, event_type="billing.store_state_observed")):
            self.assertEqual(self.claim(e=e, before=fence(e)).status, "blocked")

    def test_17_synthetic_upstream_outage_is_fail_closed(self):
        self.assertEqual(self.claim(failpoint="upstream_outage").reason,
            "UNAVAILABLE_UPSTREAM_PORT")
        self.assertEqual(self.model.count_claims(), 0)

    def test_18_two_contending_sqlite_connections_cannot_both_claim(self):
        primary = sqlite3.connect("file:r005_test_shared_18?mode=memory&cache=shared",
                                   uri=True, isolation_level=None, timeout=0.0)
        competitor = sqlite3.connect("file:r005_test_shared_18?mode=memory&cache=shared",
                                      uri=True, isolation_level=None, timeout=0.0)
        model = mod.OfflineReceiptCasModel(conn=primary)
        try:
            competitor.execute("BEGIN IMMEDIATE")
            r = model.local_claim(self.e, self.f, self.f)
            self.assertEqual(r.reason, "LOCAL_TRANSACTION_ROLLED_BACK")
            self.assert_no_rights(r)
            competitor.execute("ROLLBACK")
            ok = model.local_claim(self.e, self.f, self.f)
            self.assertEqual(ok.status, "review_only")
            self.assertEqual(model.count_claims(), 1)
            self.assertEqual(model.count_outbox(), 1)
        finally:
            if competitor.in_transaction:
                competitor.rollback()
            competitor.close()
            primary.close()
            model.witness.close()

    def test_19_missing_fake_witness_never_authorizes_ack(self):
        self.claim()
        r = self.model.inspect_simulated_floor(self.e)
        self.assertEqual(r.reason, "SIMULATED_WITNESS_MISSING")
        self.assert_no_rights(r)

    def test_20_separate_sqlite_witness_match_is_review_only_not_independent(self):
        self.claim()
        revision = self.model.local_revision(self.e)
        w = self.model.write_simulated_external_floor(self.e, revision, self.e.digest)
        self.assertEqual(w.status, "review_only")
        self.assert_no_rights(w)
        r = self.model.inspect_simulated_floor(self.e)
        self.assertEqual(r.reason, "SIMULATED_FLOOR_MATCH_NOT_AUTHORITY")
        self.assert_no_rights(r)

    def test_21_fake_witness_port_outage_denies(self):
        self.claim()
        self.assertEqual(self.model.inspect_simulated_floor(self.e, outage=True).status,
            "blocked")

    def test_22_witness_floor_older_or_conflicting_digest_denied(self):
        self.claim()
        self.model.write_simulated_external_floor(self.e, 1, "b" * 64)
        self.assertEqual(self.model.inspect_simulated_floor(self.e).reason,
            "SIMULATED_WITNESS_CONFLICT")
        self.assertEqual(self.model.count_outbox(), 1)

    def test_23_pitr_primary_rollback_detected_by_separate_memory_witness(self):
        self.claim()
        self.model.write_simulated_external_floor(self.e, 5, self.e.digest)
        r = self.model.inspect_simulated_floor(self.e)
        self.assertEqual(r.reason, "SIMULATED_PITR_ROLLBACK_DETECTED")
        self.assert_no_rights(r)

    def test_24_removed_primary_receipt_cannot_be_revived_from_old_snapshot(self):
        self.claim()
        rev = self.model.local_revision(self.e)
        self.model.write_simulated_external_floor(self.e, rev, self.e.digest)
        self.model.db.execute("DELETE FROM p05_r005_outbox")
        self.model.db.execute("DELETE FROM p05_r005_claim")
        r = self.model.inspect_simulated_floor(self.e)
        self.assertEqual(r.reason, "SIMULATED_PITR_ROLLBACK_DETECTED")
        self.assert_no_rights(r)

    def test_25_independent_port_must_not_alias_primary_connection(self):
        conn = sqlite3.connect(":memory:", isolation_level=None)
        with self.assertRaisesRegex(ValueError, "WITNESS_MUST_NOT_BE_PRIMARY_CONNECTION"):
            mod.OfflineReceiptCasModel(conn, conn)
        conn.close()

    def test_26_bad_fake_witness_input_denied_and_no_send_port(self):
        for digest in ("invalid", "A" * 64):
            r = self.model.write_simulated_external_floor(self.e, 1, digest)
            self.assertEqual(r.reason, "INVALID_SIMULATED_WITNESS")
            self.assert_no_rights(r)
        for key in ("send", "ack", "publish", "deploy", "grant", "call_d1"):
            self.assertFalse(hasattr(self.model, key))

if __name__ == "__main__":
    unittest.main()
