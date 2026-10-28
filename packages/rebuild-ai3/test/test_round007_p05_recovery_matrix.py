"""AI-3 R007 independent offline A/B ADR recovery ordering / legal uncertainty tests."""
from dataclasses import replace
from pathlib import Path
import importlib.util
import sys
import unittest

SRC = Path(__file__).resolve().parents[1] / 'src' / 'wave1_r007_p05_recovery_matrix.py'
SPEC = importlib.util.spec_from_file_location('wave1_r007_p05_recovery_matrix', SRC)
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)


class RecoveryMatrixTests(unittest.TestCase):
    def setUp(self):
        self.c = mod.Candidate()
        self.s = mod.Snapshot()

    def model(self, opt='A_ONE_STARRY_AUTHORITY'):
        return mod.OfflineRecoveryMatrix(opt)

    def safe(self, r):
        for flag in ('real_authority_verified','independent_pitr_witness_verified',
                     'may_ack','may_send','may_enqueue','may_grant_battery',
                     'may_sell_battery','may_write_real_d1','may_publish','live'):
            self.assertFalse(getattr(r, flag), flag)

    def test_01_candidate_version_and_parent_fixed(self):
        self.assertIn('r007',mod.CONTRACT)
        self.assertEqual(mod.PARENT,'5be61848f745cc17de449d773147b8a6a5b5b742')

    def test_02_adr_option_required_neither_is_preselected(self):
        for opt in ('C_READ_THEN_WRITE','',None,1,'production'):
            with self.assertRaises(ValueError): self.model(opt)

    def test_03_both_adr_scenarios_are_local_only(self):
        for opt in mod.SCENARIOS:
            m=self.model(opt); r=m.claim(self.c,self.s,self.s)
            self.assertEqual(r.status,'review_only'); self.safe(r)
            self.assertEqual((m.receipt_count(),m.pending_count()),(1,1))

    def test_04_no_trusted_auth_port(self):
        for field in ('state','legal','hold'):
            bad=replace(self.s,**{field:'unknown'})
            m=self.model(); r=m.claim(self.c,bad,bad)
            self.assertEqual(r.status,'blocked'); self.safe(r)
            self.assertEqual(m.receipt_count(),0)

    def test_05_pre_and_post_revoke_version_race(self):
        m=self.model()
        for bad in (replace(self.s,state='revoked'),replace(self.s,auth_version=4),
                    replace(self.s,session_version=5),replace(self.s,actor='wrong')):
            self.assertEqual(m.claim(self.c,self.s,bad).status,'blocked')
        self.assertEqual(m.pending_count(),0)

    def test_06_unknown_or_expired_legal_candidate_blocks(self):
        m=self.model()
        for legal in ('expired','unknown','pending','approved_live'):
            bad=replace(self.s,legal=legal)
            self.assertEqual(m.claim(self.c,bad,bad).status,'blocked')
        self.assertEqual(m.receipt_count(),0)

    def test_07_erasure_hold_requires_policy_decision(self):
        m=self.model()
        for hold in ('active','unknown','release_requested'):
            bad=replace(self.s,hold=hold)
            self.assertEqual(m.claim(self.c,bad,bad).status,'blocked')

    def test_08_both_strategies_crash_after_receipt_rollback(self):
        for opt in mod.SCENARIOS:
            m=self.model(opt)
            self.assertEqual(m.claim(self.c,self.s,self.s,crash_at='after_receipt').status,'blocked')
            self.assertEqual((m.receipt_count(),m.pending_count()),(0,0))

    def test_09_both_strategies_crash_after_outbox_rollback(self):
        for opt in mod.SCENARIOS:
            m=self.model(opt)
            self.safe(m.claim(self.c,self.s,self.s,crash_at='after_outbox'))
            self.assertEqual((m.receipt_count(),m.pending_count()),(0,0))

    def test_10_crash_before_commit_recovery_allows_review_only(self):
        m=self.model('B_DURABLE_OUTBOX_SAGA')
        self.assertEqual(m.claim(self.c,self.s,self.s,crash_at='before_commit').status,'blocked')
        self.safe(m.claim(self.c,self.s,self.s))
        self.assertEqual((m.receipt_count(),m.pending_count()),(1,1))

    def test_11_duplicate_claim_never_ack(self):
        m=self.model();m.claim(self.c,self.s,self.s)
        r=m.claim(self.c,self.s,self.s)
        self.assertEqual(r.reason,'DUPLICATE_RECEIPT');self.safe(r)
        self.assertEqual(m.pending_count(),1)

    def test_12_conflicting_digest_and_idempotency(self):
        m=self.model();m.claim(self.c,self.s,self.s)
        for c in (replace(self.c,digest='b'*64), replace(self.c,event_id='different_event')):
            r=m.claim(c,replace(self.s,event_id=c.event_id),replace(self.s,event_id=c.event_id))
            self.assertEqual(r.status,'blocked');self.safe(r)
        self.assertEqual(m.receipt_count(),1)

    def test_13_cross_brand_and_prod_refused(self):
        m=self.model()
        for c in (replace(self.c,brand='hglobal'),replace(self.c,environment='production')):
            self.assertEqual(m.claim(c,self.s,self.s).status,'blocked')
        self.assertEqual(m.receipt_count(),0)

    def test_14_bool_integer_version_rejected(self):
        m=self.model()
        self.assertEqual(m.claim(replace(self.c,auth_version=True),self.s,self.s).status,'blocked')
        self.assertEqual(m.receipt_count(),0)

    def test_15_witness_missing_unavailable_denies(self):
        m=self.model();m.claim(self.c,self.s,self.s)
        for r in (m.reconciliation(self.c),m.reconciliation(self.c,witness_available=False)):
            self.assertEqual(r.status,'blocked');self.safe(r)

    def test_16_synthetic_witness_match_never_grants(self):
        m=self.model();m.claim(self.c,self.s,self.s);m.record_fake_witness(self.c)
        r=m.reconciliation(self.c)
        self.assertEqual(r.status,'review_only');self.safe(r)

    def test_17_witness_digest_conflict_denied(self):
        m=self.model();m.claim(self.c,self.s,self.s)
        m.record_fake_witness(self.c,digest='b'*64)
        self.assertEqual(m.reconciliation(self.c).reason,'SIMULATED_WITNESS_DISAGREEMENT')

    def test_18_witness_higher_revision_detects_rollback(self):
        m=self.model();m.claim(self.c,self.s,self.s)
        m.record_fake_witness(self.c,revision=2)
        self.assertEqual(m.reconciliation(self.c).reason,'SIMULATED_PRIMARY_PITR_ROLLBACK')

    def test_19_primary_restore_to_old_snapshot_detected(self):
        m=self.model();m.claim(self.c,self.s,self.s);m.record_fake_witness(self.c)
        self.safe(m.restore_primary_to_before_claim(self.c))
        self.assertEqual((m.receipt_count(),m.pending_count()),(0,0))
        r=m.reconciliation(self.c)
        self.assertEqual(r.reason,'SIMULATED_PRIMARY_PITR_ROLLBACK');self.safe(r)

    def test_20_late_revoke_or_delete_after_local_commit_blocks(self):
        m=self.model();m.claim(self.c,self.s,self.s);m.record_fake_witness(self.c)
        for state in ('revoked','deleted','unknown'):
            r=m.reconciliation(self.c,late=replace(self.s,state=state))
            self.assertEqual(r.reason,'LATE_REVOKE_ERASURE_OR_LEGAL_DRIFT');self.safe(r)

    def test_21_late_policy_expiration_hold_drift_blocks(self):
        m=self.model();m.claim(self.c,self.s,self.s);m.record_fake_witness(self.c)
        for late in (replace(self.s,legal='expired'),replace(self.s,hold='active')):
            self.assertEqual(m.reconciliation(self.c,late=late).status,'blocked')

    def test_22_unknown_fault_rejected_without_side_effect(self):
        m=self.model()
        self.assertEqual(m.claim(self.c,self.s,self.s,crash_at='unlisted').status,'blocked')
        self.assertEqual(m.receipt_count(),0)

    def test_23_no_transport_real_data_or_paid_methods(self):
        m=self.model()
        for name in ('ack','send','enqueue','publish','restore_real_d1','grant_battery',
                     'sell_battery','call_cloudflare','verify_hmac','issue_signing_key'):
            self.assertFalse(hasattr(m,name),name)

    def test_24_all_result_flags_default_false(self):
        m=self.model()
        for r in (m.claim(self.c,self.s,self.s),m.record_fake_witness(self.c),
                  m.reconciliation(self.c)):
            self.safe(r)


if __name__ == '__main__': unittest.main()
