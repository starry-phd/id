"""AI-3 R007: synthetic P05 receipt recovery ordering/ADR options, offline only.

Neither option has been selected. Both exercise ONE disposable sqlite3 :memory:
connection. A separate second memory connection is only a simulated witness;
there is no independent PITR durability, trusted signer/Session, D1 or Queue.
No object in this module can authorize delivery, ACK, grant or production work.
"""
from __future__ import annotations
from dataclasses import dataclass
import sqlite3

CONTRACT = "starry.ai3.p05.recovery-matrix.r007.v1-offline-candidate"
PARENT = "5be61848f745cc17de449d773147b8a6a5b5b742"
SCENARIOS = ("A_ONE_STARRY_AUTHORITY", "B_DURABLE_OUTBOX_SAGA")


@dataclass(frozen=True)
class Candidate:
    brand: str = "starry"
    app: str = "starry-id"
    environment: str = "staging"
    event_id: str = "evt_r007_test_123"
    idem: str = "idem_r007_test_123"
    digest: str = "a" * 64
    actor: str = "actor_r007_test_123"
    auth_version: int = 2
    session_version: int = 3


@dataclass(frozen=True)
class Snapshot:
    event_id: str = "evt_r007_test_123"
    actor: str = "actor_r007_test_123"
    auth_version: int = 2
    session_version: int = 3
    state: str = "active"
    legal: str = "synthetic_valid"  # never a decision about Q104/Q119
    hold: str = "none"


@dataclass(frozen=True)
class Review:
    status: str
    reason: str
    scenario: str
    synthetic_local_commit: bool = False
    real_authority_verified: bool = False
    independent_pitr_witness_verified: bool = False
    may_ack: bool = False
    may_send: bool = False
    may_enqueue: bool = False
    may_grant_battery: bool = False
    may_sell_battery: bool = False
    may_write_real_d1: bool = False
    may_publish: bool = False
    live: bool = False


class OfflineRecoveryMatrix:
    """Isolated test-only SQL. A/B are ADR labels, NOT implementation elections."""

    def __init__(self, scenario: str):
        if scenario not in SCENARIOS or type(scenario) is not str:
            raise ValueError("ADR_OPTION_NOT_APPROVED_OR_UNKNOWN")
        self.scenario = scenario
        self.primary = sqlite3.connect(":memory:", isolation_level=None)
        self.witness = sqlite3.connect(":memory:", isolation_level=None)
        self.primary.execute("PRAGMA foreign_keys=ON")
        self.primary.executescript("""
            CREATE TABLE receipt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand TEXT NOT NULL, app TEXT NOT NULL, env TEXT NOT NULL,
                event_id TEXT NOT NULL, idem TEXT NOT NULL,
                digest TEXT NOT NULL, actor TEXT NOT NULL,
                UNIQUE(brand,app,env,event_id), UNIQUE(brand,app,env,idem));
            CREATE TABLE outbox (
                receipt_id INTEGER PRIMARY KEY REFERENCES receipt(id),
                state TEXT NOT NULL CHECK(state='synthetic_pending'));
        """)
        self.witness.execute("""
            CREATE TABLE fake_external_floor (
                event_id TEXT PRIMARY KEY, revision INTEGER, digest TEXT);
        """)

    def _result(self, status: str, reason: str, committed: bool = False) -> Review:
        return Review(status, reason, self.scenario, committed)

    @staticmethod
    def _valid(c: object, before: object, after: object) -> bool:
        if type(c) is not Candidate or type(before) is not Snapshot or type(after) is not Snapshot:
            return False
        if (c.brand != "starry" or c.environment not in ("development", "staging") or
            not isinstance(c.app, str) or not c.app or
            not isinstance(c.event_id, str) or not c.event_id or
            not isinstance(c.idem, str) or not c.idem or
            not isinstance(c.digest, str) or len(c.digest) != 64 or
            any(x not in "0123456789abcdef" for x in c.digest)):
            return False
        if before != after:
            return False
        if (before.event_id != c.event_id or before.actor != c.actor or
            before.auth_version != c.auth_version or
            before.session_version != c.session_version or
            type(c.auth_version) is not int or type(c.session_version) is not int or
            c.auth_version < 1 or c.session_version < 0):
            return False
        # No policy term, jurisdiction, retention duration or erasure rule chosen.
        return (before.state == "active" and before.legal == "synthetic_valid"
                and before.hold == "none")

    def claim(self, c: object, before: object, after: object,
              *, crash_at: str | None = None) -> Review:
        if not self._valid(c, before, after):
            return self._result("blocked", "UNTRUSTED_OR_CHANGED_AUTH_OR_LEGAL")
        if crash_at not in (None, "after_receipt", "after_outbox", "before_commit"):
            return self._result("blocked", "UNKNOWN_LOCAL_FAULT")
        try:
            self.primary.execute("BEGIN IMMEDIATE")
            prior = self.primary.execute("""
                SELECT event_id,idem,digest,actor FROM receipt
                WHERE brand=? AND app=? AND env=? AND (event_id=? OR idem=?)""",
                (c.brand,c.app,c.environment,c.event_id,c.idem)).fetchall()
            if prior:
                self.primary.execute("ROLLBACK")
                exact = len(prior) == 1 and prior[0] == (c.event_id,c.idem,c.digest,c.actor)
                return self._result("blocked", "DUPLICATE_RECEIPT" if exact else "CONFLICTING_RECEIPT")
            cursor = self.primary.execute("""
                INSERT INTO receipt(brand,app,env,event_id,idem,digest,actor)
                VALUES (?,?,?,?,?,?,?)""",
                (c.brand,c.app,c.environment,c.event_id,c.idem,c.digest,c.actor))
            if crash_at == "after_receipt":
                raise RuntimeError("SYNTHETIC_CRASH")
            self.primary.execute("INSERT INTO outbox VALUES (?,'synthetic_pending')", (cursor.lastrowid,))
            if crash_at in ("after_outbox", "before_commit"):
                raise RuntimeError("SYNTHETIC_CRASH")
            self.primary.execute("COMMIT")
            return self._result("review_only", "LOCAL_ATOMIC_COMMIT_NOT_REAL_D1", True)
        except (sqlite3.Error, RuntimeError):
            if self.primary.in_transaction:
                self.primary.execute("ROLLBACK")
            return self._result("blocked", "SYNTHETIC_TRANSACTION_ROLLBACK")

    def receipt_count(self) -> int:
        return self.primary.execute("SELECT COUNT(*) FROM receipt").fetchone()[0]

    def pending_count(self) -> int:
        return self.primary.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]

    def record_fake_witness(self, c: Candidate, revision: int = 1,
                            *, digest: str | None = None) -> Review:
        if type(c) is not Candidate or type(revision) is not int or revision < 1:
            return self._result("blocked", "BAD_SYNTHETIC_WITNESS")
        d = c.digest if digest is None else digest
        self.witness.execute("INSERT OR REPLACE INTO fake_external_floor VALUES (?,?,?)",
                             (c.event_id,revision,d))
        return self._result("review_only", "SECOND_MEMORY_ONLY_NOT_PITR")

    def restore_primary_to_before_claim(self, c: Candidate) -> Review:
        """Emulate unsafe old snapshot; never performs a real restore."""
        if type(c) is not Candidate:
            return self._result("blocked", "INVALID_FIXTURE")
        self.primary.execute("BEGIN IMMEDIATE")
        self.primary.execute("DELETE FROM outbox WHERE receipt_id IN (SELECT id FROM receipt WHERE event_id=?)",
                             (c.event_id,))
        self.primary.execute("DELETE FROM receipt WHERE event_id=?", (c.event_id,))
        self.primary.execute("COMMIT")
        return self._result("blocked", "SYNTHETIC_PRIMARY_ROLLED_BACK")

    def reconciliation(self, c: Candidate, *, witness_available: bool = True,
                       late: Snapshot | None = None) -> Review:
        if type(c) is not Candidate or witness_available is not True:
            return self._result("blocked", "SIMULATED_WITNESS_UNAVAILABLE")
        if late is not None and (type(late) is not Snapshot or late.state != "active"
                                or late.legal != "synthetic_valid" or late.hold != "none"
                                or late.event_id != c.event_id or late.actor != c.actor
                                or late.auth_version != c.auth_version
                                or late.session_version != c.session_version):
            return self._result("blocked", "LATE_REVOKE_ERASURE_OR_LEGAL_DRIFT")
        w = self.witness.execute("SELECT revision,digest FROM fake_external_floor WHERE event_id=?",
                                 (c.event_id,)).fetchone()
        p = self.primary.execute("SELECT id,digest FROM receipt WHERE event_id=?",
                                 (c.event_id,)).fetchone()
        if w is None:
            return self._result("blocked", "SIMULATED_WITNESS_MISSING")
        if p is None or p[0] < w[0]:
            return self._result("blocked", "SIMULATED_PRIMARY_PITR_ROLLBACK")
        if p[0] != w[0] or p[1] != w[1]:
            return self._result("blocked", "SIMULATED_WITNESS_DISAGREEMENT")
        if self.pending_count() == 0:
            return self._result("blocked", "OUTBOX_NOT_COMMITTED")
        return self._result("review_only", "LOCAL_RECONCILED_STILL_NOT_AUTHORITY", True)
