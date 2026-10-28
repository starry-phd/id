# AI-3 Wave1 R008 | P05/P06 recovery × privacy/erasure failure-order

**Scope:** #4 official AI-0 [R008 order](https://github.com/starry-phd/id/issues/4#issuecomment-6476964085). Parent exactly [AI-0 R008 governance Draft #227](https://github.com/starry-phd/id/pull/227) \`aecdee944158b40ffbbd129ddd126136687d7652\`. Starry-only, DEV-A/DEV-H; no live data or authority. Source/test/docs are 3 ADDED AI-3 paths. Inherited R006/R007 original blobs and all other Owners unchanged.

## P05/P06 failure-order evidence (SQLite :memory: only)

| Order / failure | Local deterministic check | Authority |
|---|---|---|
| Revoked/deleted/unknown Auth before local write | Deny claim; before/after session, actor, auth_version, privacy_epoch must match | Synthetic fixture only |
| Q104/Q119 retention, erasure, hold unknown | Deny; no inferred lawful retention/deletion duration | **NOT DECIDED** |
| Crash after receipt or outbox / pre-commit | SQLite atomic transaction rollback both records | Not D1 durability |
| Duplicate event/idempotency/nonce or conflicting digest | Refuse duplicate/competing local claims | No Queue ACK/retry |
| P06 erasure request before enqueue | Local synthetic quarantine barrier prevents claim | NOT real PII deletion |
| P06 after local commit, simulated enqueue, before ACK or during recovery | Atomic local outbox quarantine; pending claim does not become sendable | No actual Queue/send |
| Revocation, late deletion, hold or law changes after local commit | Fresh state mismatch fails all queue/recovery boundaries | No true current Auth source |
| Fake memory witness missing, unavailable, different digest or higher floor | Fail closed; simulated local PITR rollback caught by retained fake floor | NOT an independent durable anti-PITR witness |
| Primary old-snapshot restore after synthetic erasure | Local barrier can disappear but second memory fixture's synthetic erasure-floor causes denial | This is a simulation, NOT real PITR proof |
| Matching fake witness / local commit | \`review_only\` at most | All live privilege booleans false |

A/B #87 **both UNDECIDED**: \`A_ONE_STARRY_AUTHORITY\` and \`B_DURABLE_OUTBOX_SAGA\` are labels over **the same one disposable in-memory SQLite transaction**, not a real distributed saga or authoritative D1 placement.

Q104/Q119 **still require legal/owner decisions**: per-purpose legal basis, jurisdictional retention schedule, lawful erasure, dispute hold and release; no duration, lawful automatic removal rule or protected personal-data processing is asserted. Test fixtures use synthetic opaque IDs and hashes; no email, phone, name, payload or real PII field. The P06 event is only a local quarantine signal and never deletes a user account or real data.

## Tests and safety

\`python3 -m unittest packages/rebuild-ai3/test/test_round008_p05_p06_failure_order.py -v\` — 34 deterministic negative/safety cases. No network, real cloud, secrets, external data or provider calls. All Verdict flags \`trusted_auth_verified,legal_policy_approved,independent_pitr_verified,real_d1_committed,may_ack,may_send,may_enqueue,may_retry,may_grant_battery,may_sell_battery,may_erase_real_pii,may_publish,live\` permanently false even when local review is successful. Battery permanently FREE; Ads SDK/requests OFF. No H-Global.

P06/admin future interface only: immutable review/audit reason codes and synthetic privacy barrier. Not a live P06 audit endpoint, official retention approval, privacy API or compliant storage system; no P06 production attestation. P05 canonical, AI-1 Auth, AI-2 Billing, AI-4 Worker/Cloudflare unchanged.

**Gate1 PARTIAL/BLOCKED**: physical issuer/KMS, real monotonic Auth, Q104/Q119 legal, #87 A/B, durable D1 CAS/outbox, physical independent anti-PITR, commit-before-Queue ACK all pending. **Gate2 R008 owner only after this new exact-SHA GitHub Actions passes**, AI-0 [R008 partial 2/4 #230](https://github.com/starry-phd/id/pull/230) is not full 4/4. **Gate3 G00–G10 11/11 BLOCKED**, \`P05/PUBLISHABLE=false\`, \`release_authorization.granted=false\`. Cloudflare id-starry Preview/production auto builds OFF, do not re-enable. No main merge, deployments, real D1/R2/Queue, Store/RevenueCat/EAS, Ads, secrets, paid resources. Expo54 unchanged.

**Rollback:** close this isolated R008 Draft, discard 3 added AI-3 files. Parent #227, previous R007 all-owner #226, existing #230 partial 2/4, main and other Owner Drafts unchanged. AI-0 alone imports original Git Blobs to new full-owner R008 Gate and reruns same-SHA CI.