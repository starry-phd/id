# AI-3 REBUILD Third Round: P05, Audit, Queue and crash recovery

Status: Draft offline adapter and SQLite in-memory. Not deployed. Baseline AI-0 [PR #35](https://github.com/starry-phd/id/pull/35), SHA c59c5dcdf97b8fdfb12b5bf76bfd8f85271febcd (99 Node + 35 SQLite pass), but Gate 0 requirements and Gate 1 live services remain BLOCKED.

AI-0 is the ONLY canonical P05 schema/version/event allowlist owner. AI-2 Billing candidate version billing.p05.v1-candidate differs from AI-3 storage version rebuild-ai3.0.1-candidate. The AI-3 port accepts only a server-injected AI-0 approval and projects it into a separate redacted Audit record. Do not call either version production-approved. AI-1 owns session/identity. AI-2 owns sandbox store verification and atomic Billing owner/event/entitlement/outbox; AI-3 owns inbox/audit/quarantine; AI-4 owns the actual Worker Queue, ACK, DLQ and transport composition.

Process: AI-4 supplies a trusted after-commit AI-2 DB reader, never HTTP-supplied verified-provider booleans. AI-3 verifies 13 strict candidate P05 fields and scope, time, opaque actor, durable idempotency key, then calls AI-0 server-only canonical Gate. Only after one AI-3 D1 transaction commits BOTH claim+append can an AI-4 Queue adapter ACK. Crash before commit => rollback+retry. Crash after commit before ACK => same digest/event duplicate ACK. Conflicting digest/event or untrusted payload => durably quarantine BEFORE ACK. If quarantine or source fails, retry with bounded backoff; at max attempts return dlq_required, NOT ACK: AI-4 must durably persist DLQ before ACK. Nothing in this draft invokes real Queue, D1 or remote payment.

SQLite :memory: verifies atomic rollback, unique keys, competing writers on shared-memory two connections, append-only audit and privacy-safe fields. Not a guarantee of Cloudflare D1 multi-Worker contention, cross-D1 atomicity or real provider verifier.

Remaining AI-0 Gate: single canonical P05 version, exact events, opaque actor format, retention/erasure policy, physical D1/DO hot-key strategy, privileged replay approval. Battery is permanently free and Starry-only; no wallet, grants, FEFO, credits or purchase.

Verification: strict TS, Node negative tests, Python unittest discover. Source only packages/rebuild-ai3 and its dedicated workflow; no main merge, no Production, real D1, Queue, H-Global or paid services.
