"""AI-3 R006: AI-0 P05 vNext 17-key *structure* -> R005 disposable SQLite review.

Only offline synthetic fixtures. NO HMAC verifier/signer, trusted Auth issuer, real
D1/Queue, physical independent anti-PITR witness, notification or release port.
A 64-hex mac is a SHAPE CHECK, never a verified signature. All outcomes deny ACK.
"""
from __future__ import annotations
from dataclasses import dataclass
import importlib.util
from pathlib import Path
import re
import sys

BASE = Path(__file__).with_name("wave1_r005_p05_sqlite_cas.py")
SPEC = importlib.util.spec_from_file_location("wave1_r005_p05_sqlite_cas", BASE)
if SPEC.name in sys.modules:
    r005 = sys.modules[SPEC.name]
else:
    r005 = importlib.util.module_from_spec(SPEC)
    sys.modules[SPEC.name] = r005
    SPEC.loader.exec_module(r005)

CONTRACT = "starry.ai3.p05.vnext-sqlite-evidence.r006.v1-offline-candidate"
CANONICAL_VNEXT = "starry.p05.canonical.vnext.offline-candidate"
PURPOSE = "p05_delivery_review_only"
DOMAIN = "starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1"
AI0_BASE = "55b8e31a64b62828dbdeb075f38150f02983fa86"
AUTH_PIN = "starry.auth.p05-envelope-r005.v1-offline-candidate"
QUEUE_PIN = "starry.ai4.wave1.r003.protected-interop.v1-offline-candidate"
FIELDS = (
    "version", "purpose", "brand_id", "app_id", "environment", "event_id",
    "event_type", "actor_ref", "auth_version", "session_version",
    "idempotency_key", "issuer_kid", "issuer_epoch", "issued_at", "expires_at",
    "nonce", "payload_sha256",
)
ALLOWED = frozenset(("notification.delivery.queued", "identity.session.revoked",
                     "identity.member.deleted", "privacy.erasure.requested"))
IDENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$")
KID = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")
NONCE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
HEX = re.compile(r"^[a-f0-9]{64}$")
SAFE_MAX = 2**53 - 1


def _integer(x: object, minimum: int = 0) -> bool:
    return type(x) is int and minimum <= x <= SAFE_MAX


@dataclass(frozen=True)
class SyntheticObservation:
    """Untrusted authoring of an Auth + Q104/Q119 snapshot, never a legal approval."""
    fence: r005.FixtureFence
    legal_valid_until: int


@dataclass(frozen=True)
class Decision:
    contract: str
    status: str
    reason: str
    local_sqlite_claim: bool = False
    cryptographic_verified: bool = False
    external_witness_verified: bool = False
    may_ack: bool = False
    may_send: bool = False
    may_enqueue: bool = False
    may_retry: bool = False
    may_write_real_d1: bool = False
    may_grant_battery: bool = False
    may_sell_battery: bool = False
    may_publish: bool = False
    live: bool = False


def _deny(reason: str, local: bool = False) -> Decision:
    return Decision(CONTRACT, "blocked", reason, local)


def _parse(raw: object, scope: object, now: object):
    # EXACT order matters for the agreed AI-0 domain/JSON.stringify proposal;
    # this module intentionally does NOT calculate or verify HMAC bytes.
    if type(raw) is not dict or tuple(raw) != ("envelope", "mac_hex"):
        return None, "INVALID_WRAPPER"
    env = raw["envelope"]
    if type(env) is not dict or tuple(env) != FIELDS:
        return None, "INVALID_17_KEY_ORDER"
    mac = raw["mac_hex"]
    if type(mac) is not str or not HEX.fullmatch(mac):
        return None, "UNVERIFIED_MAC_SHAPE"
    if type(scope) is not dict or tuple(scope) != ("brand_id", "app_id", "environment"):
        return None, "INVALID_SCOPE"
    if scope["brand_id"] != "starry" or scope["environment"] not in ("development", "staging"):
        return None, "INVALID_SCOPE"
    if any(type(env[k]) is not str for k in (
        "version", "purpose", "brand_id", "app_id", "environment", "event_id",
        "event_type", "actor_ref", "idempotency_key", "issuer_kid", "nonce",
        "payload_sha256")):
        return None, "INVALID_FIELD_TYPE"
    if env["version"] != CANONICAL_VNEXT or env["purpose"] != PURPOSE:
        return None, "WRONG_CONTRACT"
    if any(env[k] != scope[k] for k in ("brand_id", "app_id", "environment")):
        return None, "CROSS_SCOPE"
    if env["event_type"] not in ALLOWED:
        return None, "UNAPPROVED_EVENT"
    if not all(IDENT.fullmatch(env[k]) for k in (
        "app_id", "event_id", "actor_ref", "idempotency_key")):
        return None, "INVALID_IDENTIFIER"
    if not KID.fullmatch(env["issuer_kid"]) or not NONCE.fullmatch(env["nonce"]):
        return None, "INVALID_ISSUER_OR_NONCE"
    if not HEX.fullmatch(env["payload_sha256"]):
        return None, "INVALID_PAYLOAD_DIGEST"
    if (not _integer(env["auth_version"], 1) or
        not _integer(env["session_version"]) or
        not _integer(env["issuer_epoch"], 1) or
        not _integer(env["issued_at"]) or not _integer(env["expires_at"]) or
        not _integer(now)):
        return None, "INVALID_INTEGER"
    if not (env["issued_at"] < env["expires_at"] <= env["issued_at"] + 120):
        return None, "INVALID_TTL"
    if env["issued_at"] > now + 5 or now >= env["expires_at"]:
        return None, "EXPIRED_OR_FUTURE"
    return env, None


def proposed_domain_values(raw: object) -> tuple | None:
    """DATA ONLY: the AI-0 18-element [domain,...17 values] proposal, no MAC."""
    if type(raw) is not dict or tuple(raw) != ("envelope", "mac_hex"):
        return None
    e = raw["envelope"]
    if type(e) is not dict or tuple(e) != FIELDS:
        return None
    return (DOMAIN, *(e[k] for k in FIELDS))


class OfflineR006P05Review:
    """Caller must supply an isolated R005 in-memory SQLite test model."""
    def __init__(self, model: r005.OfflineReceiptCasModel):
        if type(model) is not r005.OfflineReceiptCasModel:
            raise ValueError("R006_DISPOSABLE_R005_SQLITE_MODEL_REQUIRED")
        self.model = model

    def review(self, raw: object, scope: object, now: object,
               before: SyntheticObservation, after: SyntheticObservation,
               *, failpoint: str | None = None,
               witness_fault: str | None = None) -> Decision:
        e, error = _parse(raw, scope, now)
        if error:
            return _deny(error)
        if (type(before) is not SyntheticObservation or
            type(after) is not SyntheticObservation or before != after or
            not _integer(before.legal_valid_until) or
            before.legal_valid_until <= now):
            return _deny("LATE_REVOKE_OR_LEGAL_EXPIRATION")
        f = before.fence
        if (type(f) is not r005.FixtureFence or
            f.event_id != e["event_id"] or f.actor_ref != e["actor_ref"] or
            f.auth_version != e["auth_version"] or
            f.session_version != e["session_version"]):
            return _deny("EVENT_ACTOR_SESSION_MISMATCH")
        event = r005.FixtureEvent(
            brand_id="starry", app_id=e["app_id"],
            environment=e["environment"], event_id=e["event_id"],
            idempotency_key=e["idempotency_key"], nonce=e["nonce"],
            digest=e["payload_sha256"], actor_ref=e["actor_ref"],
            event_type=e["event_type"])
        # This is intentionally NOT verifying raw.mac_hex, KeyLease or event
        # issuer. A "valid looking" string may create ONLY disposable LOCAL data.
        local = self.model.local_claim(event, f, after.fence, failpoint=failpoint)
        if local.status != "review_only":
            return _deny("LOCAL_" + local.reason)
        if witness_fault not in (None, "missing", "outage", "mismatch", "rollback", "match"):
            return _deny("UNKNOWN_SIMULATED_WITNESS_FAULT", True)
        if witness_fault:
            if witness_fault in ("mismatch", "rollback", "match"):
                revision = self.model.local_revision(event)
                floor = revision + 1 if witness_fault == "rollback" else revision
                digest = "b" * 64 if witness_fault == "mismatch" else event.digest
                self.model.write_simulated_external_floor(event, floor, digest)
            witness = self.model.inspect_simulated_floor(
                event, outage=(witness_fault == "outage"))
            if witness.status == "blocked":
                return _deny("SIMULATED_" + witness.reason, True)
        return Decision(CONTRACT, "review_only",
                        "UNVERIFIED_VNEXT_SHAPE_LOCAL_SQLITE_ONLY",
                        local_sqlite_claim=True)
