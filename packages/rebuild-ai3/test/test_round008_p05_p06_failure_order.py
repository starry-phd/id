"""AI-3 R008 deterministic P05/P06 local failure-order/erasure refusal tests."""
import importlib.util
from dataclasses import replace
from pathlib import Path
import sys
import unittest

SRC = Path(__file__).resolve().parents[1] / "src" / "wave1_r008_p05_p06_failure_order.py"
SPEC = importlib.util.spec_from_file_location("wave1_r008_p05_p06_failure_order", SRC)
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)


class R008FailureOrderTest(unittest.TestCase):
    def setUp(self):
        self.event = mod.SyntheticEvent()
        self.state = mod.SyntheticState()

    def m(self, strategy=None):
        return mod.OfflineP05P06FailureOrder(strategy or mod.STRATEGIES[0])

    def safe(self, verdict):
        self.assertIsInstance(verdict, mod.Verdict)
        for key in ("trusted_auth_verified","legal_policy_approved",
                    "independent_pitr_verified","real_d1_committed",
                    "may_ack","may_send","may_enqueue","may_retry",
                    "may_grant_battery","may_sell_battery",
                    "may_erase_real_pii","may_publish","live"):
            self.assertIs(getattr(verdict,key),False,key)
        self.assertNotIn(self.event.actor,verdict.reason)

    def test_01_exact_base_and_offline_contract(self):
        self.assertEqual(mod.BASE,"aecdee944158b40ffbbd129ddd126136687d7652")
        self.assertIn("r008",mod.CONTRACT)

    def test_02_both_adr_choices_unselected_unknown_rejected(self):
        self.assertEqual(len(mod.STRATEGIES),2)
        for x in (None,"","C_READ_AFTER_WRITE","production",4):
            with self.assertRaises(ValueError):mod.OfflineP05P06FailureOrder(x)

    def test_03_both_options_local_success_stays_review_only(self):
        for strategy in mod.STRATEGIES:
            m=self.m(strategy);r=m.local_review(self.event,self.state,self.state)
            self.assertEqual(r.status,"review_only");self.safe(r)
            self.assertEqual(m.counts(),(1,1,0))

    def test_04_unverified_current_auth_no_live_promotion(self):
        m=self.m()
        self.safe(m.local_review(self.event,self.state,self.state))
        self.assertFalse(hasattr(m,"resolve_current_auth"))

    def test_05_stale_actor_both_before_after(self):
        m=self.m();stale=replace(self.state,actor="actor_r008_stale_000")
        for a,b in ((stale,stale),(self.state,stale),(stale,self.state)):
            self.assertEqual(m.local_review(self.event,a,b).status,"blocked")
        self.assertEqual(m.counts(),(0,0,0))

    def test_06_session_and_auth_monotonic_drift(self):
        m=self.m()
        for kw in (dict(auth_version=1),dict(auth_version=4),
                   dict(session_version=2),dict(session_version=4),
                   dict(privacy_epoch=2),dict(auth_version=True)):
            bad=replace(self.state,**kw)
            self.assertEqual(m.local_review(self.event,self.state,bad).status,"blocked")

    def test_07_current_auth_unknown_or_revoked(self):
        m=self.m()
        for auth in ("revoked","deleted","unknown","verified_real"):
            bad=replace(self.state,auth=auth)
            self.assertEqual(m.local_review(self.event,bad,bad).status,"blocked")
        self.assertEqual(m.counts(),(0,0,0))

    def test_08_erasure_retention_hold_unresolved_block(self):
        m=self.m()
        for field,value in (("erasure","requested"),("erasure","completed"),
                            ("retention","unknown"),("legal","undecided"),
                            ("hold","active"),("hold","unknown")):
            bad=replace(self.state,**{field:value})
            self.assertEqual(m.local_review(self.event,bad,bad).status,"blocked")
        self.assertEqual(m.counts(),(0,0,0))

    def test_09_claim_rejects_production_other_brand(self):
        m=self.m()
        for kw in ({"env":"production"},{"brand":"hglobal"},{"app":"x"}):
            e=replace(self.event,**kw)
            self.assertEqual(m.local_review(e,self.state,self.state).status,"blocked")

    def test_10_no_pii_in_receipt_and_outbox_schema(self):
        m=self.m()
        names={r[1] for t in ("r008_receipt","r008_outbox",
                             "r008_privacy_barrier") for r in
               m.db.execute("PRAGMA table_info("+t+")")}
        for field in ("email","phone","address","name","payload","ip","token"):
            self.assertNotIn(field,names)

    def test_11_crash_after_receipt_atomic_rollback(self):
        for strategy in mod.STRATEGIES:
            m=self.m(strategy)
            r=m.local_review(self.event,self.state,self.state,crash="after_receipt")
            self.assertEqual(r.reason,"LOCAL_ATOMIC_ROLLBACK");self.safe(r)
            self.assertEqual(m.counts(),(0,0,0))

    def test_12_crash_after_outbox_atomic_rollback(self):
        for strategy in mod.STRATEGIES:
            m=self.m(strategy)
            r=m.local_review(self.event,self.state,self.state,crash="after_outbox")
            self.assertEqual(r.status,"blocked");self.safe(r)
            self.assertEqual(m.counts(),(0,0,0))

    def test_13_before_commit_crash_retry_review_only(self):
        m=self.m();self.safe(m.local_review(self.event,self.state,self.state,crash="before_commit"))
        self.assertEqual(m.counts(),(0,0,0))
        self.safe(m.local_review(self.event,self.state,self.state))
        self.assertEqual(m.counts(),(1,1,0))

    def test_14_bad_crash_does_not_write(self):
        m=self.m();r=m.local_review(self.event,self.state,self.state,crash="network_live")
        self.assertEqual(r.status,"blocked");self.assertEqual(m.counts(),(0,0,0))

    def test_15_exact_replay_duplicate_not_second_queue(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        r=m.local_review(self.event,self.state,self.state)
        self.assertEqual(r.reason,"DUPLICATE_LOCAL_CLAIM");self.safe(r)
        self.assertEqual(m.counts(),(1,1,0))

    def test_16_competing_idempotency_nonce_and_digest(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        for kw in ({"digest":"b"*64},{"event_id":"evt_r008_other_002"},
                   {"idempotency":"idem_r008_other_002"},
                   {"nonce":"nonce_r008_other_002"}):
            e=replace(self.event,**kw)
            r=m.local_review(e,self.state,self.state)
            self.assertEqual(r.status,"blocked");self.safe(r)
        self.assertEqual(m.counts(),(1,1,0))

    def test_17_erasure_before_enqueue_blocks_creation(self):
        m=self.m();r=m.p06_erasure_barrier(self.event,phase="before_enqueue")
        self.safe(r);self.assertEqual(r.status,"blocked")
        self.assertEqual(m.local_review(self.event,self.state,self.state).reason,
                         "PRIVACY_ERASURE_BARRIER")
        self.assertEqual(m.counts(),(0,0,1))

    def test_18_erasure_after_commit_quarantines_outbox(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        self.safe(m.p06_erasure_barrier(self.event,phase="after_local_commit"))
        row=m.db.execute("SELECT state FROM r008_outbox").fetchone()
        self.assertEqual(row,("synthetic_quarantined",))
        self.assertEqual(m.queue_boundary(self.event,self.state).status,"blocked")

    def test_19_erasure_after_enqueue_before_ack_blocks(self):
        for phase in ("after_simulated_enqueue","before_ack"):
            m=self.m();m.local_review(self.event,self.state,self.state)
            m.p06_erasure_barrier(self.event,phase=phase)
            self.safe(m.queue_boundary(self.event,self.state,stage="before_ack"))
            self.assertEqual(m.recovery_review(self.event,self.state).status,"blocked")

    def test_20_erasure_during_recovery_blocks(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        m.p06_erasure_barrier(self.event,phase="after_local_recovery")
        self.assertEqual(m.recovery_review(self.event,self.state).reason,
                         "PRIVACY_ERASURE_BARRIER")

    def test_21_revocation_before_enqueue_after_commit_before_ack(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        revoked=replace(self.state,auth="revoked")
        for stage in ("before_enqueue","after_simulated_enqueue","before_ack",
                      "consumer_retry"):
            r=m.queue_boundary(self.event,revoked,stage=stage)
            self.assertEqual(r.reason,"STALE_REVOKED_ERASED_OR_HOLD");self.safe(r)

    def test_22_late_hold_legal_delete_drift_denies_retry(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        for kw in ({"hold":"active"},{"legal":"expired"},
                   {"retention":"unknown"},{"erasure":"requested"},
                   {"session_version":5},{"privacy_epoch":3}):
            after=replace(self.state,**kw)
            self.assertEqual(m.recovery_review(self.event,after).status,"blocked")
            self.safe(m.queue_boundary(self.event,after,stage="consumer_retry"))

    def test_23_even_clean_queue_boundaries_never_send_ack_retry(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        for stage in ("before_enqueue","after_simulated_enqueue","before_ack",
                      "consumer_retry"):
            r=m.queue_boundary(self.event,self.state,stage=stage)
            self.assertEqual(r.reason,"NO_REAL_COMMIT_NO_INDEPENDENT_WITNESS")
            self.safe(r)

    def test_24_fake_witness_missing_outage_default_deny(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        for r in (m.recovery_review(self.event,self.state),
                  m.recovery_review(self.event,self.state,witness_available=False)):
            self.assertEqual(r.status,"blocked");self.safe(r)

    def test_25_fake_memory_witness_matching_is_not_authority(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        self.safe(m.fake_witness_write(self.event))
        r=m.recovery_review(self.event,self.state)
        self.assertEqual(r.status,"review_only");self.safe(r)

    def test_26_fake_witness_mismatch_and_higher_floor(self):
        for revision,digest in ((1,"b"*64),(2,None)):
            m=self.m();m.local_review(self.event,self.state,self.state)
            m.fake_witness_write(self.event,revision,digest)
            r=m.recovery_review(self.event,self.state)
            self.assertEqual(r.status,"blocked");self.safe(r)

    def test_27_pitr_old_snapshot_cannot_resurrect_delivery(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        m.fake_witness_write(self.event)
        self.safe(m.simulated_pitr_restore(self.event))
        self.assertEqual(m.counts(),(0,0,0))
        self.assertEqual(m.recovery_review(self.event,self.state).reason,
                         "SIMULATED_PITR_ROLLBACK_DETECTED")

    def test_28_erasure_floor_survives_synthetic_primary_rollback(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        m.p06_erasure_barrier(self.event,phase="after_local_commit")
        m.fake_witness_write(self.event,erasure=True)
        m.simulated_pitr_restore(self.event)
        r=m.recovery_review(self.event,self.state)
        self.assertEqual(r.reason,"SIMULATED_ERASURE_FLOOR_DETECTED");self.safe(r)

    def test_29_fake_witness_not_independent_and_invalid_values(self):
        m=self.m()
        self.assertIsNot(m.db,m.fake_witness)
        for kw in ({"revision":0},{"revision":True},{"digest":"bad"}):
            self.assertEqual(m.fake_witness_write(self.event,**kw).status,"blocked")

    def test_30_p06_repeated_request_idempotent_and_quarantined(self):
        m=self.m();m.local_review(self.event,self.state,self.state)
        m.p06_erasure_barrier(self.event,phase="before_ack")
        r=m.p06_erasure_barrier(self.event,phase="before_ack")
        self.safe(r);self.assertEqual(m.counts(),(1,1,1))
        self.assertEqual(m.db.execute("SELECT state FROM r008_outbox").fetchone(),
                         ("synthetic_quarantined",))

    def test_31_unknown_erasure_phase_and_queue_phase_rejected(self):
        m=self.m()
        self.assertEqual(m.p06_erasure_barrier(self.event,phase="real_delete").status,
                         "blocked")
        self.assertEqual(m.queue_boundary(self.event,self.state,stage="live_ack").status,
                         "blocked")
        self.assertEqual(m.counts(),(0,0,0))

    def test_32_no_real_apis_and_release_always_blocked(self):
        m=self.m()
        for attr in ("ack","send","queue_send","send_notification","delete_pii",
                     "publish","grant_battery","sell_battery","deploy",
                     "write_real_d1","verify_current_auth","sign"):
            self.assertFalse(hasattr(m,attr),attr)
        r=m.local_review(self.event,self.state,self.state)
        self.safe(r)

    def test_33_each_strategy_erasure_before_ack_always_denied(self):
        for strategy in mod.STRATEGIES:
            m=self.m(strategy);m.local_review(self.event,self.state,self.state)
            m.p06_erasure_barrier(self.event,phase="before_ack")
            self.safe(m.queue_boundary(self.event,self.state))
            self.assertEqual(m.counts(),(1,1,1))

    def test_34_unapproved_issuer_true_claim_rejected(self):
        m=self.m();fake=replace(self.state,issuer="verified_real")
        self.assertEqual(m.local_review(self.event,fake,fake).status,"blocked")

if __name__ == "__main__":
    unittest.main()
