# AI-3 R10 free Battery | D1-shaped single-database CAS settlement

Authority: AI-0 Issue #1 latest Q89–125 decisions, AI-3 Issue #4. Base fixed verified AI-0 R9 #76 SHA e5a3ba76695316b3eaeb218fb0edd901d8820931 and AI-0 #70 GitHub single-commit SOP. R9 AI-4 #72 Task atomic settlement already integrated; do NOT rebuild its task proof. R9 AI-1 #73 protected appeal/reviewer and AI-2 #75 Store reconcile are also already integrated.

## Executable offline scope
- New server-only AI-3 D1-shaped candidate: settle an **existing** free-Battery hold with optimistic wallet version/balance CAS, held task price/policy_version/expires_ms + exact three-minute deadline, status update, append-only transaction journal and same-batch readback.
- Transaction abort mechanism: each D1.batch wallet UPDATE, hold UPDATE and journal INSERT is immediately followed by a SQL changes() scratch assertion INSERT with CHECK(ok=1). Zero rows changed or duplicate journal raises a SQLite constraint and rolls back the D1.batch. Scratch assertion rows are cleaned inside the same batch. No ACK, no Queue release, no live Worker route.
- Deliberately limited to commit, failure release, TTL expiry; it does NOT grant X or Y and does not touch AI-1 fingerprint. Tested via Node negative D1 stub and independent disposable SQLite :memory: concurrency/rollback fault simulations.
- D1.batch is an atomic *single database* boundary ONLY. A trusted source-port check outside it can be stale: cross-service AI-1 active Member, AI-4 proof, policy version and Q119 anti-regrant are NOT transactionally bound by this candidate; must be added via same-authority committed sources / independently approved consistency protocol before deployment. No real D1 migration.
- The existing 0005 Draft wallet tables do not have auth-session revision or task-proof digest, so actual Task↔Wallet atomicity across separate D1 instances is still blocked; monotonic token revocation and revalidation, signed proof and outbox replay solution require AI-0 architecture Gate.

## Release/Gate restrictions
- X/Y and per-App task prices/total debt limit not approved. Billing and IAP never fund free Battery. Q114 real attachment scanning/privacy authority and Q116 true PITR/independent backup restore remain gated.
- G00–G10 11/11 BLOCKED, all live flags false, no main merge, deployment, D1/R2/Queue/OAuth/Store/EAS/Secrets, paid services; H-Global paused.
