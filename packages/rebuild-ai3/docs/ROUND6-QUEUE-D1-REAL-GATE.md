# AI-3 R6: Queue/D1 failure matrix + real Cloudflare acceptance plan

Sources: AI-0 Issue #4 Round 6 directive; Draft #52 b4e34c4dc1fc9425e8c2730e7d2421fcbb87d4f0. Candidate only. No deploy, migration or paid resources.

## R6 offline evidence

- Missing AI-2 committed row: retry, no ACK, no premature quarantine. After five delivery attempts request durable DLQ and ACK only when DLQ persistence is confirmed. If failed DLQ causes delivery 6+, Queue adapter runs bounded policy attempt 5 but preserves actual attempt number in the DLQ receipt; no unbounded retry loop in domain policy.
- Idempotent repeated deliveries after lost ACK: one inbox, one redacted audit, no Billing entitlement writes; key/digest conflicts require durable quarantine. Superseded refund goes only to quarantine. Uncertain Billing order retries until its authoritative reader becomes available.
- D1-shaped rollback every batch step and shared SQLite-memory multi-writer contention, duplicate, append-only and privacy-column negative tests. These are local models, NOT Cloudflare D1 / Queue E2E.

## Real D1+Queues acceptance checklist (UNAPPROVED, DO NOT RUN)

1. AI-0 authorizes G00 requirements, G06 canonical event authority and explicit staging environment Gate. Current P05 billing.p05.v1-candidate is PUBLISHABLE=false; internal audit projection rebuild-ai3.0.1-candidate is a different purpose/version.
2. AI-1 provides verified live Starry session/admin identity with revocation and step-up. AI-2 provides official verified Apple/Google provider, committed Billing owner/event/CAS/outbox and authoritative event ordering. AI-3 writes only redacted audit/inbox. AI-4 provides real Workers/Queue receiver and durable DLQ. H-Global remains isolated/paused.
3. Create only isolated brand/app/runtime named test databases and Queue/DLQ after authorization. Record migrations/checksum, least-permission bindings, test-only secret handling, backup snapshots, rollback and restore procedures. Do not reuse production D1 or publish real Store events.
4. In approved test Cloudflare, exercise simultaneous Workers writing the same event key, competing D1 writers, batch abort after inbox claim, crash after audit commit but before Queue ACK, >5 redeliveries, source eventual consistency, source/provider outage, conflicting digest, stale refunds, revoked authority, DLQ down then back, human replay denied without AI-1/AI-0 independent approval.
5. Measure redacted-only metrics: duplicate/conflict/retry/lag/DLQ rates, per Worker concurrency and CPU, D1 reads/writes/lock/busy, Queue delivery/storage caps and Cloudflare service cost limits. Set hard ceilings and test-stop alerts BEFORE any paid services. No EAS Build or Update by default under DEV-I Free.
6. Cleanup requires approval: disable Queue triggers and test bindings, drain/verify DLQ, revoke temporary credentials, restore/delete isolated databases and queues, verify no real account/personal payment data or retained PII and log evidence in GitHub. Never delete production records.
7. Retention/purge/legal hold, redacted event IDs and private audit access need product/privacy approval. Battery is permanently free and Starry-only; quota/wallet/real ledger remain undecided and disabled.

## Gate status

All 11 formal Release Gates are still BLOCKED. Tests run under Node22 / SQLite :memory: only and do not authorize real Cloudflare, OAuth, Store, secrets, EAS, merge main or deployment.
