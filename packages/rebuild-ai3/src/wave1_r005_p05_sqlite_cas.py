"""Wave1 R005 AI-3: ephemeral SQLite CAS/recovery model, NOT a real D1/Queue implementation.

Only disposable sqlite3 :memory: databases. A *second* connection models an external
witness interface for fault injection, but is NOT a genuinely independent PITR witness.
No signer, Auth source, notification, cloud resource, or queue ACK is implemented.
"""
from __future__ import annotations
from dataclasses import dataclass
import re
import sqlite3

CONTRACT = "starry.ai3.p05.sqlite-cas-recovery.r005.v1-offline-candidate"
PINNED = {
    "ai0_base": "88b53f63e909798803d51b6f62cf2461e24ab690",
    "ai1_auth": "starry.auth.event-session-fence.r004.v1-candidate",
    "ai3_prior": "starry.ai3.p05.canonical-claim-handshake.r004.v1-candidate",
    "ai4_transport": "starry.ai4.wave1.r003.protected-interop.v1-offline-candidate",
    "canonical_signer": "AI0_P05_CANONICAL_SIGNER_PENDING",
}
REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
NONCE = re.compile(r"^[A-Za-z0-9_-]{8,96}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")


@dataclass(frozen=True)
class FixtureEvent:
    app_id: str
    environment: str
    event_id: str
    idempotency_key: str
    nonce: str
    digest: str
    actor_ref: str
    event_type: str = "notification.delivery.queued"
    brand_id: str = "starry"


@dataclass(frozen=True)
class FixtureFence:
    event_id: str
    actor_ref: str
    auth_version: int
    session_version: int
    state: str
    legal_policy_version: int
    lawful_now: bool
    erasure_hold: str
    issuer_state: str = "unverified_candidate"


@dataclass(frozen=True)
class LocalReview:
    status: str
    reason: str
    local_receipt_persisted: bool = False
    may_ack: bool = False
    may_send: bool = False
    may_enqueue: bool = False
    may_retry: bool = False
    may_write_real_d1: bool = False
    may_grant_battery: bool = False
    may_sell_battery: bool = False
    may_publish: bool = False
    live: bool = False


class OfflineReceiptCasModel:
    """Owns only in-memory local test schema; never attaches to remote D1."""

    def __init__(self, conn: sqlite3.Connection | None = None,
                 simulated_witness: sqlite3.Connection | None = None):
        self.db = conn if conn is not None else sqlite3.connect(":memory:", isolation_level=None)
        self.witness = (simulated_witness if simulated_witness is not None
                        else sqlite3.connect(":memory:", isolation_level=None))
        if self.db is self.witness:
            raise ValueError("WITNESS_MUST_NOT_BE_PRIMARY_CONNECTION")
        if self.db.execute("PRAGMA database_list").fetchone()[2] not in ("", None):
            raise ValueError("PRIMARY_MUST_BE_MEMORY")
        if self.witness.execute("PRAGMA database_list").fetchone()[2] not in ("", None):
            raise ValueError("WITNESS_MUST_BE_MEMORY")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS p05_r005_claim(
                revision INTEGER PRIMARY KEY AUTOINCREMENT,
                brand TEXT NOT NULL, app TEXT NOT NULL, env TEXT NOT NULL,
                event_id TEXT NOT NULL, idem TEXT NOT NULL, nonce TEXT NOT NULL,
                digest TEXT NOT NULL, actor_ref TEXT NOT NULL,
                UNIQUE(brand,app,env,event_id),
                UNIQUE(brand,app,env,idem),
                UNIQUE(brand,app,env,nonce));
            CREATE TABLE IF NOT EXISTS p05_r005_outbox(
                claim_revision INTEGER PRIMARY KEY
                    REFERENCES p05_r005_claim(revision) ON DELETE RESTRICT,
                digest TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state='local_pending'));
        """)
        self.witness.execute("""
            CREATE TABLE IF NOT EXISTS p05_r005_simulated_floor(
                brand TEXT, app TEXT, env TEXT, event_id TEXT,
                revision INTEGER NOT NULL, digest TEXT NOT NULL,
                PRIMARY KEY(brand,app,env,event_id))""")

    @staticmethod
    def _fixture_ok(event: FixtureEvent, before: FixtureFence,
                    after: FixtureFence) -> bool:
        if not isinstance(event, FixtureEvent) or not isinstance(before, FixtureFence) or not isinstance(after, FixtureFence):
            return False
        if event.brand_id != "starry" or event.environment not in ("development", "staging"):
            return False
        refs = [event.app_id, event.event_id, event.idempotency_key, event.actor_ref]
        if not all(isinstance(v, str) and REF.fullmatch(v) for v in refs):
            return False
        if not isinstance(event.nonce, str) or not NONCE.fullmatch(event.nonce):
            return False
        if not isinstance(event.digest, str) or not DIGEST.fullmatch(event.digest):
            return False
        if event.event_type not in ("notification.delivery.queued",
            "identity.session.revoked", "identity.member.deleted", "privacy.erasure.requested"):
            return False
        if before != after:
            return False
        if (before.event_id != event.event_id or before.actor_ref != event.actor_ref or
            before.issuer_state != "unverified_candidate" or
            type(before.auth_version) is not int or before.auth_version < 1 or
            type(before.session_version) is not int or before.session_version < 0 or
            type(before.legal_policy_version) is not int or before.legal_policy_version < 1 or
            before.lawful_now is not True):
            return False
        expected = ("revoked" if event.event_type == "identity.session.revoked"
                    else "deleted" if event.event_type == "identity.member.deleted" else "active")
        if before.state != expected:
            return False
        if before.erasure_hold not in ("none", "active"):
            return False
        return expected != "deleted" or before.erasure_hold == "active"

    def local_claim(self, event: FixtureEvent, before: FixtureFence,
                    after: FixtureFence, *, failpoint: str | None = None) -> LocalReview:
        # No cryptographic source authority is implemented. This is a local
        # transaction exercise even if a synthetic fixture appears consistent.
        if not self._fixture_ok(event, before, after):
            return LocalReview("blocked", "UNTRUSTED_EVENT_SESSION_OR_LAW")
        if failpoint == "upstream_outage":
            return LocalReview("blocked", "UNAVAILABLE_UPSTREAM_PORT")
        if failpoint not in (None, "after_claim", "after_outbox", "before_commit"):
            return LocalReview("blocked", "UNKNOWN_FAILPOINT")
        scope = (event.brand_id, event.app_id, event.environment)
        try:
            self.db.execute("BEGIN IMMEDIATE")
            existing = self.db.execute("""
                SELECT event_id,idem,nonce,digest FROM p05_r005_claim
                WHERE brand=? AND app=? AND env=? AND
                      (event_id=? OR idem=? OR nonce=?)""",
                (*scope, event.event_id, event.idempotency_key, event.nonce)).fetchall()
            if existing:
                self.db.execute("ROLLBACK")
                same = len(existing) == 1 and existing[0] == (
                    event.event_id, event.idempotency_key, event.nonce, event.digest)
                return LocalReview("blocked", "DUPLICATE_LOCAL_CLAIM" if same else "CONFLICTING_LOCAL_CLAIM")
            cur = self.db.execute("""
                INSERT INTO p05_r005_claim
                    (brand,app,env,event_id,idem,nonce,digest,actor_ref)
                    VALUES (?,?,?,?,?,?,?,?)""",
                (*scope, event.event_id, event.idempotency_key, event.nonce,
                 event.digest, event.actor_ref))
            if failpoint == "after_claim":
                raise RuntimeError("SIMULATED_AFTER_CLAIM_CRASH")
            self.db.execute("""
                INSERT INTO p05_r005_outbox (claim_revision,digest,state)
                VALUES (?,?,'local_pending')""", (cur.lastrowid, event.digest))
            if failpoint in ("after_outbox", "before_commit"):
                raise RuntimeError("SIMULATED_PRE_COMMIT_CRASH")
            self.db.execute("COMMIT")
            return LocalReview("review_only", "LOCAL_SQLITE_COMMITTED_NOT_D1", True)
        except (RuntimeError, sqlite3.Error):
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            return LocalReview("blocked", "LOCAL_TRANSACTION_ROLLED_BACK")

    def count_claims(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM p05_r005_claim").fetchone()[0]

    def count_outbox(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM p05_r005_outbox").fetchone()[0]

    def local_revision(self, event: FixtureEvent) -> int | None:
        row = self.db.execute("""
            SELECT revision FROM p05_r005_claim
            WHERE brand=? AND app=? AND env=? AND event_id=?""",
            (event.brand_id, event.app_id, event.environment, event.event_id)).fetchone()
        return row[0] if row else None

    def write_simulated_external_floor(self, event: FixtureEvent,
                                       revision: int, digest: str) -> LocalReview:
        """Fault-injection only: NOT a real monotonic or independent witness."""
        if (not isinstance(event, FixtureEvent) or type(revision) is not int or
            revision <= 0 or not isinstance(digest, str) or not DIGEST.fullmatch(digest)):
            return LocalReview("blocked", "INVALID_SIMULATED_WITNESS")
        self.witness.execute("""
            INSERT INTO p05_r005_simulated_floor VALUES (?,?,?,?,?,?)
            ON CONFLICT(brand,app,env,event_id) DO UPDATE SET
                revision=excluded.revision,digest=excluded.digest
            WHERE excluded.revision>p05_r005_simulated_floor.revision""",
            (event.brand_id, event.app_id, event.environment,
             event.event_id, revision, digest))
        return LocalReview("review_only", "SIMULATED_WITNESS_ONLY")

    def inspect_simulated_floor(self, event: FixtureEvent, *,
                                outage: bool = False) -> LocalReview:
        if not isinstance(event, FixtureEvent) or outage:
            return LocalReview("blocked", "SIMULATED_WITNESS_UNAVAILABLE")
        w = self.witness.execute("""
            SELECT revision,digest FROM p05_r005_simulated_floor
            WHERE brand=? AND app=? AND env=? AND event_id=?""",
            (event.brand_id, event.app_id, event.environment, event.event_id)).fetchone()
        p = self.db.execute("""
            SELECT revision,digest FROM p05_r005_claim
            WHERE brand=? AND app=? AND env=? AND event_id=?""",
            (event.brand_id, event.app_id, event.environment, event.event_id)).fetchone()
        if w is None:
            return LocalReview("blocked", "SIMULATED_WITNESS_MISSING")
        if p is None or p[0] < w[0]:
            return LocalReview("blocked", "SIMULATED_PITR_ROLLBACK_DETECTED")
        if p != w:
            return LocalReview("blocked", "SIMULATED_WITNESS_CONFLICT")
        return LocalReview("review_only", "SIMULATED_FLOOR_MATCH_NOT_AUTHORITY")
