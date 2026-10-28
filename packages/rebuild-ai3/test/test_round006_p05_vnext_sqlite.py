"""AI-3 R006: exact AI-0 vNext P05 DATA-ONLY contract and offline CAS negatives."""
from dataclasses import replace
import importlib.util
from pathlib import Path
import sys
import unittest

SRC = Path(__file__).resolve().parents[1] / "src" / "wave1_r006_p05_vnext_sqlite_review.py"
SPEC = importlib.util.spec_from_file_location("wave1_r006_p05_vnext_sqlite_review", SRC)
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)

SCOPE = {"brand_id": "starry", "app_id": "starry-id", "environment": "staging"}
NOW = 1010

def message(**changes):
    values = {
        "version": mod.CANONICAL_VNEXT,
        "purpose": mod.PURPOSE,
        "brand_id": "starry",
        "app_id": "starry-id",
        "environment": "staging",
        "event_id": "evt_123456789",
        "event_type": "notification.delivery.queued",
        "actor_ref": "actor_12345678",
        "auth_version": 2,
        "session_version": 4,
        "idempotency_key": "idem_12345678",
        "issuer_kid": "kid_123",
        "issuer_epoch": 3,
        "issued_at": 1000,
        "expires_at": 1060,
        "nonce": "nonce_12345678901",
        "payload_sha256": "a" * 64,
    }
    values.update(changes)
    return {"envelope": {k: values[k] for k in mod.FIELDS}, "mac_hex": "f" * 64}

def observation(m=None, **changes):
    m = m or message()
    e = m["envelope"]
    f = mod.r005.FixtureFence(
        event_id=e["event_id"], actor_ref=e["actor_ref"],
        auth_version=e["auth_version"], session_version=e["session_version"],
        state="active", legal_policy_version=2, lawful_now=True,
        erasure_hold="none", issuer_state="unverified_candidate")
    return mod.SyntheticObservation(replace(f, **changes), 1040)

class P05R006(unittest.TestCase):
    def setUp(self):
        self.store = mod.r005.OfflineReceiptCasModel()
        self.a = mod.OfflineR006P05Review(self.store)
        self.m = message()
        self.o = observation(self.m)

    def assert_safe(self, result):
        self.assertEqual(result.contract, mod.CONTRACT)
        for field in ("cryptographic_verified", "external_witness_verified",
                      "may_ack", "may_send", "may_enqueue", "may_retry",
                      "may_write_real_d1", "may_grant_battery",
                      "may_sell_battery", "may_publish", "live"):
            self.assertIs(getattr(result, field), False, field)
        self.assertNotIn("actor_12345678", str(result))
        self.assertNotIn("nonce_12345678901", str(result))

    def run_review(self, m=None, before=None, after=None, scope=None,
                   now=NOW, **kwargs):
        m = self.m if m is None else m
        before = self.o if before is None else before
        after = before if after is None else after
        scope = SCOPE if scope is None else scope
        r = self.a.review(m, scope, now, before, after, **kwargs)
        self.assert_safe(r)
        return r

    def test_01_ai0_exact_17_field_and_pins(self):
        self.assertEqual(len(mod.FIELDS), 17)
        self.assertEqual(tuple(self.m["envelope"]), mod.FIELDS)
        self.assertEqual(mod.CANONICAL_VNEXT, "starry.p05.canonical.vnext.offline-candidate")
        self.assertEqual(mod.AUTH_PIN, "starry.auth.p05-envelope-r005.v1-offline-candidate")
        self.assertIn("r003", mod.QUEUE_PIN)

    def test_02_exact_domain_array_without_hmac(self):
        values = mod.proposed_domain_values(self.m)
        self.assertEqual(len(values), 18)
        self.assertEqual(values[0], "starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1")
        self.assertEqual(values[1:], tuple(self.m["envelope"].values()))
        self.assertEqual(self.run_review().status, "review_only")
        self.assertEqual(self.store.count_claims(), 1)

    def test_03_apparently_complete_mac_never_authorizes(self):
        r = self.run_review()
        self.assertEqual(r.reason, "UNVERIFIED_VNEXT_SHAPE_LOCAL_SQLITE_ONLY")
        self.assertTrue(r.local_sqlite_claim)
        self.assertFalse(r.cryptographic_verified)

    def test_04_ai0_r005_legacy_wrapper_rejected(self):
        old = {"event": self.m["envelope"], "signature_hex": "f" * 64}
        self.assertEqual(self.run_review(old).reason, "INVALID_WRAPPER")

    def test_05_ai1_r005_legacy_mac_wrapper_rejected(self):
        old = {"envelope": self.m["envelope"], "mac": "f" * 64}
        self.assertEqual(self.run_review(old).reason, "INVALID_WRAPPER")

    def test_06_exact_order_missing_extra_17_field_rejected(self):
        e = self.m["envelope"]
        variants = [dict(reversed(list(e.items()))),
                    {k: v for k, v in e.items() if k != "nonce"},
                    {**e, "signature_verified": True}]
        for v in variants:
            self.assertEqual(self.run_review({"envelope": v, "mac_hex": "f" * 64}).reason,
                             "INVALID_17_KEY_ORDER")
        self.assertEqual(self.store.count_claims(), 0)

    def test_07_own_dict_only_not_user_mapping_or_accessor(self):
        class Hostile(dict):
            def __getitem__(self, k):
                raise RuntimeError("unsafe getter")
        self.assertEqual(self.run_review({"envelope": Hostile(self.m["envelope"]),
                                         "mac_hex": "f" * 64}).reason, "INVALID_17_KEY_ORDER")
        self.assertEqual(self.run_review(Hostile(self.m)).reason, "INVALID_WRAPPER")

    def test_08_version_purpose_event_type_denied(self):
        for x in (message(version="ai0-r005"),
                  message(purpose="notification_send"),
                  message(event_type="billing.store_state_observed")):
            self.assertEqual(self.run_review(x).status, "blocked")

    def test_09_brand_app_env_scope_and_production_denied(self):
        for m in (message(brand_id="hglobal"), message(app_id="foreign-app"),
                  message(environment="production")):
            self.assertEqual(self.run_review(m).reason, "CROSS_SCOPE")
        self.assertEqual(self.run_review(scope={**SCOPE, "environment": "production"}).reason,
                         "INVALID_SCOPE")
        self.assertEqual(self.store.count_claims(), 0)

    def test_10_issuer_kid_epoch_nonce_bad_payload_denied(self):
        for m in (message(issuer_kid="!"), message(issuer_epoch=0),
                  message(nonce="short"), message(payload_sha256="xyz")):
            self.assertEqual(self.run_review(m).status, "blocked")

    def test_11_mac_shape_is_not_signature_validation(self):
        for mac in ("A" * 64, "a" * 63, "not-a-mac", True):
            self.assertEqual(self.run_review({"envelope": self.m["envelope"],
                                             "mac_hex": mac}).reason,
                             "UNVERIFIED_MAC_SHAPE")
        self.assertEqual(self.store.count_claims(), 0)

    def test_12_int_types_bool_overflow_and_time_denied(self):
        for m in (message(auth_version=True), message(session_version=-1),
                  message(issuer_epoch=2**53), message(issued_at=1000.5)):
            self.assertEqual(self.run_review(m).status, "blocked")

    def test_13_expired_future_and_ttl_121s_denied(self):
        self.assertEqual(self.run_review(message(expires_at=1121)).reason, "INVALID_TTL")
        self.assertEqual(self.run_review(message(issued_at=1016, expires_at=1050)).reason,
                         "EXPIRED_OR_FUTURE")
        self.assertEqual(self.run_review(now=1060).reason, "EXPIRED_OR_FUTURE")
        self.assertEqual(self.store.count_claims(), 0)

    def test_14_wrong_event_or_actor_binding_denied(self):
        for bad in (replace(self.o.fence, event_id="evt_foreign"),
                    replace(self.o.fence, actor_ref="actor_foreign"),
                    replace(self.o.fence, auth_version=3),
                    replace(self.o.fence, session_version=5)):
            r = self.run_review(before=mod.SyntheticObservation(bad, 1040))
            self.assertEqual(r.reason, "EVENT_ACTOR_SESSION_MISMATCH")
        self.assertEqual(self.store.count_claims(), 0)

    def test_15_late_revoke_deleted_and_unknown_block_delivery(self):
        for state in ("revoked", "deleted", "unknown"):
            r = self.run_review(after=mod.SyntheticObservation(
                replace(self.o.fence, state=state), 1040))
            self.assertEqual(r.reason, "LATE_REVOKE_OR_LEGAL_EXPIRATION")
        self.assertEqual(self.store.count_claims(), 0)

    def test_16_legal_expiration_or_policy_drift_denied(self):
        for b, a in [
            (mod.SyntheticObservation(self.o.fence, 1009), self.o),
            (self.o, mod.SyntheticObservation(self.o.fence, 1009)),
            (self.o, mod.SyntheticObservation(replace(self.o.fence,
                legal_policy_version=3), 1040))]:
            self.assertEqual(self.run_review(before=b, after=a).reason,
                             "LATE_REVOKE_OR_LEGAL_EXPIRATION")
        self.assertEqual(self.store.count_claims(), 0)

    def test_17_erasure_event_needs_matching_deleted_and_hold(self):
        m = message(event_type="identity.member.deleted")
        obs = observation(m)
        self.assertEqual(self.run_review(m, obs).status, "blocked")
        valid = mod.SyntheticObservation(replace(obs.fence,
             state="deleted", erasure_hold="active"), 1040)
        self.assertEqual(self.run_review(m, valid).status, "review_only")

    def test_18_same_event_replay_is_not_an_ack(self):
        self.assertEqual(self.run_review().status, "review_only")
        self.assertEqual(self.run_review().reason, "LOCAL_DUPLICATE_LOCAL_CLAIM")
        self.assertEqual(self.store.count_outbox(), 1)

    def test_19_competing_claim_digest_and_nonce_denied(self):
        self.run_review()
        changed = message(payload_sha256="b" * 64)
        self.assertEqual(self.run_review(changed).reason, "LOCAL_CONFLICTING_LOCAL_CLAIM")
        replay = message(event_id="evt_second", idempotency_key="idem_second")
        self.assertEqual(self.run_review(replay, observation(replay)).reason,
                         "LOCAL_CONFLICTING_LOCAL_CLAIM")
        self.assertEqual(self.store.count_claims(), 1)

    def test_20_local_failpoints_crash_and_recovery_remain_review_only(self):
        self.assertEqual(self.run_review(failpoint="after_claim").reason,
                         "LOCAL_LOCAL_TRANSACTION_ROLLED_BACK")
        self.assertEqual(self.store.count_claims(), 0)
        self.assertEqual(self.run_review(failpoint="after_outbox").status, "blocked")
        self.assertEqual(self.run_review(failpoint="before_commit").status, "blocked")
        self.assertEqual(self.store.count_outbox(), 0)
        self.assertEqual(self.run_review().status, "review_only")
        self.assertEqual(self.store.count_claims(), 1)

    def test_21_witness_missing_outage_mismatch_rollback_deny(self):
        for mode in ("missing", "outage", "mismatch", "rollback"):
            # Each model is an independent test fixture with disposable state.
            isolated = mod.OfflineR006P05Review(mod.r005.OfflineReceiptCasModel())
            decision = isolated.review(self.m, SCOPE, NOW, self.o, self.o,
                                       witness_fault=mode)
            self.assert_safe(decision)
            self.assertEqual(decision.status, "blocked", mode)
            self.assertTrue(decision.local_sqlite_claim)

    def test_22_second_memory_witness_match_never_authorizes(self):
        r = self.run_review(witness_fault="match")
        self.assertEqual(r.status, "review_only")
        self.assertEqual(r.reason, "UNVERIFIED_VNEXT_SHAPE_LOCAL_SQLITE_ONLY")
        self.assertFalse(r.external_witness_verified)
        self.assertFalse(r.may_ack)

    def test_23_upstream_and_unknown_faults_block_or_deny(self):
        self.assertEqual(self.run_review(failpoint="upstream_outage").status, "blocked")
        self.assertEqual(self.run_review(failpoint="wrong").status, "blocked")
        self.assertEqual(self.store.count_claims(), 0)

    def test_24_no_transport_signer_hmac_or_battery_grant_method(self):
        for name in ("sign", "verify_signature", "ack", "send",
                     "publish", "deploy", "grant_battery", "write_real_d1"):
            self.assertFalse(hasattr(self.a, name))

if __name__ == "__main__":
    unittest.main()
