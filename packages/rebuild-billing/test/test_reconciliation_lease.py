"""AI-2 Q113 offline SQLite :memory: lease CAS proof. Never real D1."""
import pathlib
import sqlite3
import unittest
BASE = pathlib.Path(__file__).resolve().parents[1]
SCHEMA = BASE / "schema" / "0005_reconciliation_lease_DRAFT.sql"
REF = "r_" + "a" * 64
TOKEN1 = "r_" + "b" * 64
TOKEN2 = "r_" + "c" * 64
NOW = 1793100000
CLAIM = """
UPDATE billing_reconcile_job_DRAFT
SET lease_token=?, lease_until_sec=?, attempts=attempts+1,status='leased'
WHERE job_ref=? AND brand_id='starry' AND app_id='starry.alpha'
  AND environment='staging' AND store_environment='sandbox'
  AND store='apple' AND store_app_id='phd.starry.alpha'
  AND is_deleted=0 AND next_due_sec<=? AND attempts<?
  AND (status='pending' OR (status='leased' AND lease_until_sec<=?))
RETURNING job_ref,lease_token,source_version,attempts
"""
REVIEW = """
UPDATE billing_reconcile_job_DRAFT SET
  status=?,next_due_sec=?,lease_token=NULL,lease_until_sec=NULL,
  last_review_result=?,last_review_digest=?,last_review_at_sec=?
WHERE job_ref=? AND lease_token=? AND source_version=?
  AND is_deleted=0 AND lease_until_sec>? AND status='leased'
RETURNING job_ref
"""
class BillingReconcileCAS(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(SCHEMA.read_text())
        self.db.execute("""
        INSERT INTO billing_reconcile_job_DRAFT
        (job_ref,app_id,environment,store,store_app_id,offer_id,kind,
         source_version,next_due_sec)
        VALUES (?,?,?,?,?,?,?,?,?)
        """,(REF,"starry.alpha","staging","apple","phd.starry.alpha",
             "alpha.monthly","monthly",7,NOW-1))

    def tearDown(self):
        self.db.close()

    def claim(self, token=TOKEN1, now=NOW, max_attempts=5):
        return self.db.execute(CLAIM,(token,now+60,REF,now,max_attempts,now)).fetchone()

    def review(self, token=TOKEN1, now=NOW, version=7,
               status="pending", due=None):
        return self.db.execute(REVIEW,(status,NOW+600 if due is None else due,
            "candidate_observation","d"*64,now,REF,token,version,now)).fetchone()

    def test_one_winner_and_fenced_old_token_cannot_write(self):
        a=self.claim()
        self.assertEqual(a,(REF,TOKEN1,7,1))
        self.assertIsNone(self.claim(TOKEN2))
        self.assertIsNone(self.review(TOKEN2))
        self.assertEqual(self.review(),(REF,))
        result=self.db.execute(
            "SELECT attempts,status,lease_token,last_review_result FROM billing_reconcile_job_DRAFT"
        ).fetchone()
        self.assertEqual(result,(1,"pending",None,"candidate_observation"))

    def test_expired_lease_new_owner_wins_stale_owner_rejected(self):
        self.claim(TOKEN1)
        self.assertIsNone(self.claim(TOKEN2,NOW+59))
        self.assertEqual(self.claim(TOKEN2,NOW+60),(REF,TOKEN2,7,2))
        self.assertIsNone(self.review(TOKEN1,NOW+60))
        self.assertEqual(self.review(TOKEN2,NOW+60),(REF,))

    def test_revocation_or_version_advance_between_query_and_commit_denied(self):
        self.claim()
        self.db.execute("UPDATE billing_reconcile_job_DRAFT SET source_version=source_version+1")
        self.assertIsNone(self.review())
        self.db.execute("UPDATE billing_reconcile_job_DRAFT SET source_version=7,is_deleted=1")
        self.assertIsNone(self.review())
        self.assertEqual(self.db.execute(
           "SELECT last_review_result FROM billing_reconcile_job_DRAFT").fetchone(),(None,))

    def test_max_five_attempts_and_deleted_never_claim(self):
        self.db.execute("UPDATE billing_reconcile_job_DRAFT SET attempts=5")
        self.assertIsNone(self.claim())
        self.db.execute("UPDATE billing_reconcile_job_DRAFT SET attempts=0,is_deleted=1")
        self.assertIsNone(self.claim())

    def test_not_due_wrong_scope_and_lease_expired_cannot_review(self):
        self.db.execute("UPDATE billing_reconcile_job_DRAFT SET next_due_sec=?", (NOW+5,))
        self.assertIsNone(self.claim())
        self.db.execute("UPDATE billing_reconcile_job_DRAFT SET next_due_sec=?", (NOW-1,))
        self.assertIsNone(self.db.execute(CLAIM,(TOKEN1,NOW+60,REF,NOW-2,5,NOW)).fetchone())
        self.assertIsNotNone(self.claim())
        self.assertIsNone(self.review(now=NOW+60))

    def test_schema_rejects_hglobal_production_paid_battery_and_negative_attempts(self):
        variants=[
          ("brand_id","hglobal"),("environment","production"),
          ("store_environment","production"),("store","paypal"),
          ("offer_id","battery.paid"),("attempts",6),("is_deleted",2),
        ]
        for col,value in variants:
            with self.subTest(col=col),self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"UPDATE billing_reconcile_job_DRAFT SET {col}=?",(value,))

    def test_expiring_lease_reschedules_review_metadata_not_paid_entitlement(self):
        self.claim()
        self.assertEqual(self.review(),(REF,))
        tables={r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn("billing_entitlement",tables)
        self.assertNotIn("billing_owner",tables)
        self.assertNotIn("billing_outbox",tables)
        status=self.db.execute("""
          SELECT status,next_due_sec,last_review_at_sec,last_review_digest
          FROM billing_reconcile_job_DRAFT WHERE job_ref=?""",(REF,)).fetchone()
        self.assertEqual(status,("pending",NOW+600,NOW,"d"*64))

if __name__=="__main__":
    unittest.main()
