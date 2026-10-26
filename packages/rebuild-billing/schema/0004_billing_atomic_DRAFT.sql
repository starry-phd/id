-- AI-2 Round 4 CANDIDATE only, NEVER apply to remote/live D1.
-- Required AFTER schema/0001_billing_rebuild.DRAFT.sql in SQLite memory tests.
-- Guard check is LAST in D1 batch; failure forces rollback of owner/event/CAS/outbox.
ALTER TABLE billing_entitlement ADD COLUMN applied_event_key TEXT;
CREATE TABLE billing_atomic_receipt (
 idempotency_key TEXT PRIMARY KEY NOT NULL REFERENCES billing_event(idempotency_key),
 verified_provider INTEGER NOT NULL CHECK(verified_provider=1),
 guard_applied INTEGER NOT NULL CHECK(guard_applied=1),
 created_at TEXT NOT NULL
);
CREATE INDEX billing_event_event_lookup ON billing_event(owner_key,provider_event_ref);
CREATE INDEX billing_outbox_pending ON billing_outbox(status,created_at);
-- batch transaction must insert receipt LAST; receipt is server-only AFTER-COMMIT proof.
-- No Queue ACK/publish before full batch + authoritative committed-reader verification.
