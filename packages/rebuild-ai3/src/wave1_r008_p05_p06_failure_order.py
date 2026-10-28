"""AI-3 Wave1 R008: P05/P06 privacy/erasure and failure-order *offline* review.

Every database is a disposable sqlite3 :memory: fixture. An additional memory
connection is only a simulated anti-PITR witness, NEVER external durable proof.
No trusted issuer, current Auth, real PII, retention rule, D1, Queue, ACK, grant
or live transport is available. Both #87 candidates remain UNDECIDED.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
import sqlite3

CONTRACT = "starry.ai3.r008.p05-p06-erasure-failure-order.offline-candidate"
BASE = "aecdee944158b40ffbbd129ddd126136687d7652"
STRATEGIES = ("A_ONE_STARRY_AUTHORITY", "B_DURABLE_OUTBOX_SAGA")
PHASES = ("before_enqueue", "after_local_commit", "after_simulated_enqueue",
          "before_ack", "after_local_recovery")
HEX = re.compile(r"^[a-f0-9]{64}$")
REF = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


@dataclass(frozen=True)
class SyntheticEvent:
    brand: str = "starry"
    app: str = "starry-id"
    env: str = "staging"
    event_id: str = "evt_r008_synthetic_001"
    idempotency: str = "idem_r008_synthetic_001"
    nonce: str = "nonce_r008_synthetic_001"
    actor: str = "actor_r008_synthetic_001"
    digest: str = "a" * 64


@dataclass(frozen=True)
class SyntheticState:
    actor: str = "actor_r008_synthetic_001"
    auth_version: int = 2
    session_version: int = 3
    privacy_epoch: int = 1
    auth: str = "synthetic_current"
    legal: str = "synthetic_review_only"
    retention: str = "synthetic_review_only"
    erasure: str = "none"
    hold: str = "none"
    issuer: str = "unverified_synthetic"  # not current Auth authority


@dataclass(frozen=True)
class Verdict:
    status: str
    reason: str
    strategy: str
    local_sqlite_only: bool = False
    trusted_auth_verified: bool = False
    legal_policy_approved: bool = False
    independent_pitr_verified: bool = False
    real_d1_committed: bool = False
    may_ack: bool = False
    may_send: bool = False
    may_enqueue: bool = False
    may_retry: bool = False
    may_grant_battery: bool = False
    may_sell_battery: bool = False
    may_erase_real_pii: bool = False
    may_publish: bool = False
    live: bool = False


class OfflineP05P06FailureOrder:
    """A/B names are labels; neither implements distributed D1 or Saga."""

    def __init__(self, strategy: str):
        if type(strategy) is not str or strategy not in STRATEGIES:
            raise ValueError("UNDECIDED_ADR_STRATEGY_REQUIRED")
        self.strategy = strategy
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.fake_witness = sqlite3.connect(":memory:", isolation_level=None)
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE r008_receipt(
                revision INTEGER PRIMARY KEY AUTOINCREMENT,
                brand TEXT NOT NULL, app TEXT NOT NULL, env TEXT NOT NULL,
                event_id TEXT NOT NULL, idem TEXT NOT NULL, nonce TEXT NOT NULL,
                digest TEXT NOT NULL, actor TEXT NOT NULL,
                UNIQUE(brand,app,env,event_id),
                UNIQUE(brand,app,env,idem),
                UNIQUE(brand,app,env,nonce));
            CREATE TABLE r008_outbox(
                revision INTEGER PRIMARY KEY REFERENCES r008_receipt(revision),
                state TEXT NOT NULL CHECK(state IN
                  ('synthetic_pending','synthetic_quarantined')));
            CREATE TABLE r008_privacy_barrier(
                brand TEXT NOT NULL, app TEXT NOT NULL, env TEXT NOT NULL,
                event_id TEXT NOT NULL, phase TEXT NOT NULL,
                PRIMARY KEY(brand,app,env,event_id));
        """)
        self.fake_witness.executescript("""
            CREATE TABLE fake_floor(
                event_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
                digest TEXT NOT NULL);
            CREATE TABLE fake_erasure_floor(
                event_id TEXT PRIMARY KEY, phase TEXT NOT NULL);
        """)

    def _verdict(self, status: str, reason: str, local: bool = False) -> Verdict:
        return Verdict(status, reason, self.strategy, local)

    @staticmethod
    def _scope(e: SyntheticEvent) -> tuple[str, str, str, str]:
        return e.brand, e.app, e.env, e.event_id

    @staticmethod
    def _event_ok(e: object) -> bool:
        return (type(e) is SyntheticEvent
                and e.brand == "starry" and e.env in ("development", "staging")
                and type(e.app) is str and bool(REF.fullmatch(e.app))
                and all(type(x) is str and REF.fullmatch(x) for x in
                        (e.event_id, e.idempotency, e.nonce, e.actor))
                and type(e.digest) is str and bool(HEX.fullmatch(e.digest)))

    @staticmethod
    def _state_ok(e: SyntheticEvent, before: object, after: object) -> bool:
        if type(before) is not SyntheticState or type(after) is not SyntheticState:
            return False
        if before != after:
            return False
        s = before
        return (s.actor == e.actor and type(s.auth_version) is int
                and s.auth_version >= 1 and type(s.session_version) is int
                and s.session_version >= 0 and type(s.privacy_epoch) is int
                and s.privacy_epoch >= 1 and s.auth == "synthetic_current"
                and s.legal == "synthetic_review_only"
                and s.retention == "synthetic_review_only"
                and s.erasure == "none" and s.hold == "none"
                and s.issuer == "unverified_synthetic")

    def counts(self) -> tuple[int, int, int]:
        return tuple(self.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                     for table in ("r008_receipt", "r008_outbox",
                                   "r008_privacy_barrier"))

    def _barrier(self, e: SyntheticEvent) -> bool:
        return self.db.execute("""
            SELECT 1 FROM r008_privacy_barrier
            WHERE brand=? AND app=? AND env=? AND event_id=?""",
            self._scope(e)).fetchone() is not None

    def local_review(self, event: object, before: object, after: object,
                     *, crash: str | None = None) -> Verdict:
        if not self._event_ok(event):
            return self._verdict("blocked", "INVALID_SYNTHETIC_SCOPE_OR_EVENT")
        e = event
        if not self._state_ok(e, before, after):
            return self._verdict("blocked", "STALE_AUTH_OR_UNDECIDED_PRIVACY_LAW")
        if crash not in (None, "after_receipt", "after_outbox", "before_commit"):
            return self._verdict("blocked", "UNKNOWN_CRASH_POINT")
        if self._barrier(e):
            return self._verdict("blocked", "PRIVACY_ERASURE_BARRIER")
        try:
            self.db.execute("BEGIN IMMEDIATE")
            existing = self.db.execute("""
                SELECT event_id,idem,nonce,digest,actor FROM r008_receipt
                WHERE brand=? AND app=? AND env=?
                AND (event_id=? OR idem=? OR nonce=?)""",
                (e.brand,e.app,e.env,e.event_id,e.idempotency,e.nonce)).fetchall()
            if existing:
                self.db.execute("ROLLBACK")
                same = (len(existing) == 1
                        and existing[0] == (e.event_id,e.idempotency,
                                            e.nonce,e.digest,e.actor))
                return self._verdict("blocked", "DUPLICATE_LOCAL_CLAIM" if same
                                     else "CONFLICTING_LOCAL_CLAIM")
            cursor = self.db.execute("""
                INSERT INTO r008_receipt
                (brand,app,env,event_id,idem,nonce,digest,actor)
                VALUES (?,?,?,?,?,?,?,?)""",
                (e.brand,e.app,e.env,e.event_id,e.idempotency,e.nonce,
                 e.digest,e.actor))
            if crash == "after_receipt":
                raise RuntimeError("SIMULATED_CRASH")
            self.db.execute(
                "INSERT INTO r008_outbox VALUES (?,'synthetic_pending')",
                (cursor.lastrowid,))
            if crash in ("after_outbox", "before_commit"):
                raise RuntimeError("SIMULATED_CRASH")
            self.db.execute("COMMIT")
            return self._verdict("review_only", "LOCAL_COMMITTED_NOT_D1", True)
        except (sqlite3.Error, RuntimeError):
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            return self._verdict("blocked", "LOCAL_ATOMIC_ROLLBACK")

    def p06_erasure_barrier(self, event: object, *, phase: str,
                            current: object = None) -> Verdict:
        """A synthetic quarantine signal, never physical deletion or legal grant."""
        if not self._event_ok(event) or phase not in PHASES or type(phase) is not str:
            return self._verdict("blocked", "INVALID_SYNTHETIC_ERASURE_EVENT")
        e = event
        # Unknown/stale state *also* blocks delivery. Cannot infer lawful deletion.
        if current is not None and type(current) is not SyntheticState:
            return self._verdict("blocked", "UNTRUSTED_PRIVACY_OBSERVATION")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("""
                INSERT OR IGNORE INTO r008_privacy_barrier
                (brand,app,env,event_id,phase) VALUES (?,?,?,?,?)""",
                (*self._scope(e),phase))
            self.db.execute("""
                UPDATE r008_outbox SET state='synthetic_quarantined'
                WHERE revision IN (
                  SELECT revision FROM r008_receipt
                  WHERE brand=? AND app=? AND env=? AND event_id=?)""",
                self._scope(e))
            self.db.execute("COMMIT")
        except sqlite3.Error:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            return self._verdict("blocked", "LOCAL_BARRIER_TRANSACTION_FAILED")
        return self._verdict("blocked", "P06_PRIVACY_BLOCK_NOT_REAL_ERASURE", True)

    def fake_witness_write(self, event: object, revision: int = 1,
                           digest: str | None = None,
                           *, erasure: bool = False) -> Verdict:
        if (not self._event_ok(event) or type(revision) is not int or revision < 1
            or (digest is not None and (type(digest) is not str
                                        or not HEX.fullmatch(digest)))
            or type(erasure) is not bool):
            return self._verdict("blocked", "INVALID_FAKE_WITNESS")
        e = event
        self.fake_witness.execute("INSERT OR REPLACE INTO fake_floor VALUES (?,?,?)",
                                  (e.event_id,revision,e.digest if digest is None else digest))
        if erasure:
            self.fake_witness.execute(
                "INSERT OR REPLACE INTO fake_erasure_floor VALUES (?,?)",
                (e.event_id,"synthetic_erasure_requested"))
        return self._verdict("review_only", "SAME_HOST_MEMORY_WITNESS_NOT_INDEPENDENT", True)

    def simulated_pitr_restore(self, event: object) -> Verdict:
        """Drop local rows to emulate an OLD snapshot, not a real PITR action."""
        if not self._event_ok(event):
            return self._verdict("blocked", "INVALID_SYNTHETIC_SCOPE_OR_EVENT")
        e = event
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("""
                DELETE FROM r008_outbox WHERE revision IN
                (SELECT revision FROM r008_receipt WHERE brand=? AND app=?
                 AND env=? AND event_id=?)""", self._scope(e))
            self.db.execute("""
                DELETE FROM r008_receipt WHERE brand=? AND app=? AND env=?
                AND event_id=?""", self._scope(e))
            self.db.execute("""
                DELETE FROM r008_privacy_barrier WHERE brand=? AND app=? AND
                env=? AND event_id=?""", self._scope(e))
            self.db.execute("COMMIT")
        except sqlite3.Error:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            return self._verdict("blocked", "SIMULATED_RESTORE_ROLLED_BACK")
        return self._verdict("blocked", "UNTRUSTED_PITR_OLD_SNAPSHOT", True)

    def recovery_review(self, event: object, fresh: object,
                        *, witness_available: bool = True) -> Verdict:
        if not self._event_ok(event):
            return self._verdict("blocked", "INVALID_SYNTHETIC_SCOPE_OR_EVENT")
        e = event
        if type(fresh) is not SyntheticState or not self._state_ok(e,fresh,fresh):
            return self._verdict("blocked", "FRESH_AUTH_OR_PRIVACY_GATE_BLOCKED")
        if self._barrier(e):
            return self._verdict("blocked", "PRIVACY_ERASURE_BARRIER")
        if witness_available is not True:
            return self._verdict("blocked", "FAKE_WITNESS_OUTAGE")
        privacy_floor = self.fake_witness.execute(
            "SELECT 1 FROM fake_erasure_floor WHERE event_id=?",
            (e.event_id,)).fetchone()
        if privacy_floor is not None:
            return self._verdict("blocked", "SIMULATED_ERASURE_FLOOR_DETECTED")
        w = self.fake_witness.execute(
            "SELECT revision,digest FROM fake_floor WHERE event_id=?",
            (e.event_id,)).fetchone()
        r = self.db.execute("""
            SELECT revision,digest FROM r008_receipt WHERE brand=? AND
            app=? AND env=? AND event_id=?""", self._scope(e)).fetchone()
        if w is None:
            return self._verdict("blocked", "FAKE_WITNESS_MISSING")
        if r is None or r[0] < w[0]:
            return self._verdict("blocked", "SIMULATED_PITR_ROLLBACK_DETECTED")
        if r != w:
            return self._verdict("blocked", "SIMULATED_FLOOR_CONFLICT")
        outbox = self.db.execute(
            "SELECT state FROM r008_outbox WHERE revision=?",
            (r[0],)).fetchone()
        if outbox != ("synthetic_pending",):
            return self._verdict("blocked", "OUTBOX_NOT_PENDING")
        return self._verdict("review_only", "LOCAL_RECONCILED_BUT_NO_AUTHORITY", True)

    def queue_boundary(self, event: object, fresh: object,
                       *, stage: str = "before_ack") -> Verdict:
        """Review-only failure-order checkpoint; never calls a Queue."""
        if stage not in ("before_enqueue","after_simulated_enqueue",
                         "before_ack","consumer_retry"):
            return self._verdict("blocked", "UNKNOWN_QUEUE_PHASE")
        if not self._event_ok(event) or type(fresh) is not SyntheticState:
            return self._verdict("blocked", "UNTRUSTED_QUEUE_OBSERVATION")
        if not self._state_ok(event, fresh, fresh) or self._barrier(event):
            return self._verdict("blocked", "STALE_REVOKED_ERASED_OR_HOLD")
        return self._verdict("blocked", "NO_REAL_COMMIT_NO_INDEPENDENT_WITNESS")
