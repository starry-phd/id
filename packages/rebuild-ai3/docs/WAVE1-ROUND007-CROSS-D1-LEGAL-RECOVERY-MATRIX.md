# AI-3 Wave1 R007 | #87 / Q104 / Q119 | OFFLINE ONLY

**Status:** `starry.ai3.p05.recovery-matrix.r007.v1-offline-candidate`, not approved architecture, legal policy or production service. Parent AI-0 R006 integrated Draft #221 exact `5be61848f745cc17de449d773147b8a6a5b5b742`, whose three GitHub Actions passed offline only. Its external Cloudflare check failed separately. AI-3 R006 #217 is already source-preserved in #221; not reimplemented here.

## #87: A/B consistency comparison — neither selected

| Dimension | A: one Starry transactional authority | B: durable Outbox / Saga | Decision Gate |
|---|---|---|---|
| Write ownership | One authorized transaction and receipt/outbox owner | Domain-owned durable outbox, idempotent relay and compensations | Owner decides actual D1 layout and exclusive writer |
| Commit ordering | Local receipt and pending delivery commit together | Each service commits its local state; relay reconciles across domains | Prove real commit, Auth/legal freshness and independent witness before ACK |
| Failure recovery | Same transactional boundary; duplicate and PITR tests | Lost, duplicate and out-of-order messages, replay/retry and reconciliation | Real independent durable proof, restore drill and operations cost |
| Risks | Coupling, rights and write ownership | Larger state machine, retry/compensation complexity | Cost, latency, recovery safety, rollback and approval |
| R007 proof | One disposable SQLite memory DB only | SAME local memory model under alternative B label, no real Saga | Both review-only, never authorization |

Snapshot read-then-write across different D1 services is not an approved third option. No A/B decision is made by this PR; see https://github.com/starry-phd/id/issues/87.

## Q104/Q119: pending lawful retention / erasure matrix

| Policy situation | Human decision required | Offline fail-closed behavior |
|---|---|---|
| Purpose, consent, lawful basis | Define per-event purpose, evidence and approver | Unknown or changed policy blocks |
| Retention period and erasure | Define jurisdictional category-specific periods, minimization and deletion | No default term or actual deletion |
| Dispute/hold | Define who places/releases a hold and how deletion requests interact | Active/unknown hold blocks |
| Current Auth | Define real event/actor/session version monotonic source | Before/after drift, late revoke, delete block |
| Recovery after PITR | Define independent physical witness and approved correction process | Missing, mismatch or rollback blocks; matching second memory witness remains untrusted |

## Run and evidence

`python3 -m unittest packages/rebuild-ai3/test/test_round007_p05_recovery_matrix.py -v` runs 24 tests against Python sqlite3 :memory: only: local receipt/outbox crash rollback, replay/conflict, production/cross-brand denial, legal/erasure/hold drift, late revocation, fake witness outage/mismatch, synthetic primary snapshot rollback and permanent no-ACK behavior. Both A and B are purely labels, not selected strategies.

All `may_ack`, `may_send`, `may_enqueue`, `may_grant_battery`, `may_sell_battery`, `may_write_real_d1`, `may_publish`, `live`, `real_authority_verified`, and `independent_pitr_witness_verified` are always false. No real D1, Queue, Cloudflare, Worker, production, secrets, Store, EAS, AdMob SDK/ad requests, H-Global or fee. Battery is permanently FREE; Ads OFF.

**Gate:** Gate1 PARTIAL/BLOCKED pending approved P05 issuer/KMS, current real Auth monotonic Session, Q104/Q119, Issue #87 design, real D1 CAS/outbox, independent PITR witness, protected AI-4 commit-before-ACK. Gate2 only after this *new exact R007 SHA* passes CI; R006 #221 offline PASS is not transferable. Gate3 G00–G10 11/11 BLOCKED, `P05/PUBLISHABLE=false` and release authorization false.

**Rollback:** close this R007 Draft and discard exactly 3 new AI-3 paths. Keep #221, #217 and other Owners untouched. AI-0 alone performs later same-SHA integrated Gate.
