# AI-3 | Wave1 Round-005 | In-memory SQLite P05 CAS/receipt and simulated anti-PITR recovery

**Status:** Owner-isolated SAFE/OFFLINE ONLY; NOT an approved P05 issuer, D1 migration, witness service, or Queue consumer.

## Source of truth and pinned dependency
- AI-0 latest completed R004 four-owner integration [Draft #208](https://github.com/starry-phd/id/pull/208) fixed HEAD `88b53f63e909798803d51b6f62cf2461e24ab690` ([AI-0 Gate](https://github.com/starry-phd/id/issues/1#issuecomment-6474433288)); its three same-SHA Actions success authorizes **offline Gate2 only**, Gate1 PARTIAL/BLOCKED and Gate3 11/11 BLOCKED.
- Formal owner [AI-3 R005 dispatch](https://github.com/starry-phd/id/issues/4#issuecomment-6474450906).
- Source ownership and version pins: prior AI-3 R004 [#206](https://github.com/starry-phd/id/pull/206) `starry.ai3.p05.canonical-claim-handshake.r004.v1-candidate`; AI-1 R004 [#203](https://github.com/starry-phd/id/pull/203) `starry.auth.event-session-fence.r004.v1-candidate`; AI-4 R003 [#201](https://github.com/starry-phd/id/pull/201) `starry.ai4.wave1.r003.protected-interop.v1-offline-candidate`. The new Python candidate `starry.ai3.p05.sqlite-cas-recovery.r005.v1-offline-candidate` is separate, deliberately **not imported into those original Owner writers**.
- This R005 source is **Python `sqlite3` and disposable `:memory:` only**; no real D1, Queue, Cloudflare, external witness, Secrets, Store, file-backed SQL or paid resource.

## What the source genuinely exercises

`src/wave1_r005_p05_sqlite_cas.py` creates an in-memory `p05_r005_claim` and `p05_r005_outbox` in ONE SQLite connection, with three unique scopes on `(brand,app,environment,event_id)`, `(brand,app,environment,idempotency_key)` and `(brand,app,environment,nonce)`. `BEGIN IMMEDIATE` -> claim -> outbox -> `COMMIT`, or `ROLLBACK` with simulated crashes/competing write locks, is **locally atomic**. It explicitly rejects cross-brand/Prod, malformed digests, replayed nonce, stale Session, illegal/changed retention and unsupported event types. Even a successful local commit produces `review_only/LOCAL_SQLITE_COMMITTED_NOT_D1`; every send/ACK/grant/paid/live flag is hardcoded false.

A **second separate `:memory:` SQLite connection** represents a future anti-PITR witness interface. Its `p05_r005_simulated_floor` can be set to a higher revision to exercise rollback detection, mismatched digests, outage and missing evidence. This is ONLY **fault injection**: two memory connections are not physically independent storage or anti-rollback proof, and their clocks/keys/immutability are not trusted. `SIMULATED_FLOOR_MATCH_NOT_AUTHORITY` can never authorize a Queue ACK.

`test/test_round005_p05_receipt_sqlite.py` runs via existing CI step `python3 -m unittest discover -s packages/rebuild-ai3/test -p 'test_*.py' -v`, with 26 positive and negative tests, including:
- Local committed claim + pending outbox remains **review-only**, exact duplicate/idempotency conflicts/nonce replay, app/env isolation.
- Crash after claim / outbox / before commit; rollback leaves neither row; retry commits at most one; two real distinct SQLite connections exercise immediate lock contention.
- Revoked/deleted/unknown actor, stale Auth and late revoke; distinct deletion-audit hold; Q104/Q119 policy drift; counterfeit `issuer_state=signature_verified`, unsupported event, foreign brand/Production.
- Separate simulated witness missing/matching/mismatch/outage, lower primary revision, deleted/rolled-back primary, alias to primary rejected; **no real witness and no ACK**.

## Future owner contract and Gate1 blockers (no default decisions)

| Owner/Gate | Required evidence / alternatives (NOT approved here) |
| --- | --- |
| AI-0 canonical signer | A: single central signing issuer; B: centrally governed domain issuer. Must explicitly choose canonical serialization/envelope, trusted key storage/KID epoch/rotation, nonce/replay journal, expiry, digest and verification before Auth/Receipt reads. Python fixtures have **no signature verification**. |
| AI-1 event/actor SessionFence | Signed event-specific current Member/Session D1 read, actor_ref mapping, monotonic auth/session epoch and deletion/revocation tombstone. AI-1 R004 offline Port is version-pinned, not invoked here. |
| AI-3 Q104/Q119 | Owner must specify purposes, consent/recipient, erasure/legal hold, minimum/maximum retention, legal basis, deletion and appeal exceptions **per event class**. No fabricated durations; local boolean is insufficient. |
| #87 D1 architecture A/B | Owner/AI-0 must review authoritative Issue #87 option definitions and choose A or B, with cost, database isolation, transaction boundary, schema migration, crash recovery and rollback. No A/B selection encoded into R005 fixture. |
| AI-3 durable receipt/outbox | Real D1 transactional CAS or equivalent authoritative commit semantics, uniquely keyed event+idem+nonce, outbox commit journal, concurrent worker crash/retry and independent postcommit proof. This local SQLite code does not become a D1 adapter. |
| AI-0 independent anti-PITR | Real external, operationally independent monotonic witness must survive primary D1 PITR and support signed floor/receipt binding, read-after-write confirmation, corruption recovery and operator audit. Separate in-memory DB is a **test double**, never evidence of independence. |
| AI-4 Queue transport | Future trusted ACK-after-confirmed-physical-commit with independent external witness and current auth/legal evidence, DLQ redrive/idempotency, explicit sandbox/wrangler permissions and spending cap. Nothing calls Queue now. |

## Gate, verification and rollback

- Gate1 PARTIAL/BLOCKED, Gate2 only owner **exact HEAD offline CI** after checked, Gate3 G00-G10 11/11 BLOCKED, `P05/PUBLISHABLE=false`, `release_authorization.granted=false`.
- Every `LocalReview` always `may_ack=false`, `may_send=false`, `may_enqueue=false`, `may_retry=false`, `may_write_real_d1=false`, `may_grant_battery=false`, `may_sell_battery=false`, `may_publish=false`, `live=false`; `local_receipt_persisted` describes **only local, disposable SQLite**.
- Starry Battery forever FREE, no SKU/monetization; Q4=A AdMob Mediation selected but Ads OFF. No main merge, Preview/Staging/Production, Cloudflare Worker Build configuration, real D1/Queue/R2/Store/RevenueCat/EAS, credentials, paid resources, H-Global or private consumer App Repo. Central Expo54 unchanged.
- Rollback: close new AI-3 R005 Draft, remove exactly 3 R005-only AI-3 files. AI-0 #208 and all inherited Owner writers/source blobs remain byte-identical.
