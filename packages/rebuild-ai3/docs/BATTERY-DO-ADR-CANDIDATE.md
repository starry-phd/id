# Candidate ADR | Battery choices and hot-key atomicity for AI-0

**Not a product decision, not live code.** Source PR #25: BAT-001 approved, BAT-002 candidate, DATA-001 unique logical writer approved, DO-001 comparison approved.

Battery rule already approved: permanently free and Starry-only. Do not sell Battery through IAP or reuse previous ledgers.

| Candidate | Pros | Risks and decisions required |
| --- | --- | --- |
| Free periodic quota | Minimal records, simpler enforcement | Reset interval, per-App vs across-Starry, bursts, expiry definition |
| Free shared wallet | Cross-App flexibility | Double spend, FEFO, reservation, release/commit, expiry, negative balance and privacy |
| No balance, only fair-use limits | No persistent credits | Abuse/cost limits and user-visible fairness |

Historical 3-minute reservation, two-year expiry, FEFO and negative-two overdraft are **not approved**.

| Atomic approach | Correctness and limitation | POC needed |
| --- | --- | --- |
| D1 atomic conditional insert/CAS | Transactional within one D1; cannot atomically cover network/other D1/Queue | Multi-request same key, conflicting digest, crash after claim, replay |
| Durable Object per hot entity | Serializes a single aggregate; DO/D1/Queue projections still need outbox and compensation | Hot-key load p95/p99, restart, cross-domain failure and reconciliation |
| Queue alone | Useful delivery, not exactly-once business mutation | Durable atomic dedupe, DLQ replay authorization, no cross-brand duplication |

**Recommendation (proposal only):** keep audit metadata and dedupe SQL as test-only candidate. AI-0 to decide D1 layout/DO hot-spots with measured contention, business Battery semantics, privacy retention and authorization before implementation.
