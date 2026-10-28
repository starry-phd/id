# AI-3 Wave1 Round-004 | canonical P05 / Session / durable claim / Queue ACK handshake

- Owner: AI-3 / DEV-A+DEV-H. Dispatch [Issue #4 R004](https://github.com/starry-phd/id/issues/4#issuecomment-6474003303), [AI-0 #1 R004](https://github.com/starry-phd/id/issues/1#issuecomment-6473979811).
- Base for isolated owner branch: AI-0 R002 integrated Draft #197, exact `4215bb23bacb709fe3a659a443782032e2a1d5fe`. AI-0 had not issued a full R003 combined SHA at branch creation. **Do not claim that this R004 checkout includes sibling R003 source.**
- Candidate contract: `starry.ai3.p05.canonical-claim-handshake.r004.v1-candidate`. Read-only helper `reviewR004P05Handshake`; no server port implementation, cryptographic validation, D1 / Queue invocation or HTTP registration.
- Previous AI-3 R003 Draft #199 `6b0de28786067e686db6854efa0840d2c120a47d` remains unchanged; R004 is **a new canonical envelope + two-claim/TOCTOU interface review**, not a repeat of R003 commit-before-ACK snapshot review.
- Sibling R003 owner source read directly: AI-1 [#198](https://github.com/starry-phd/id/pull/198) `modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts` defines `R003EventAuthFenceProposal` **type only**; AI-4 [#201](https://github.com/starry-phd/id/pull/201) `apps/api/src/wave1-r003-protected-interop.ts` defines `R003FutureAuthorityPorts` and offline ordering **type / no real ACK**. This R004 checkout imports actual inherited AI-3 R002 and AI-4 R002 guards only. The new R003 sibling versions are pinned in `R004_SIBLING_CONTRACTS` for **future cross-owner Gate**, not falsely presented as executed R003 interop.
- Q4 latest owner decision is **A / Google AdMob Mediation selection**, but **Ads OFF**; this task has no ad code/SDK.

## Exact future handshake and ownership

1. **AI-0 / AI-4 canonical P05 issuer**: AI-0 approves a single server-only issuer, canonical serialization, versioned envelope, KID/epoch/key rotation and nonce/replay domain. AI-4 owns protected API/transport contract. The `issuer` candidate descriptor has `signature_state='unverified_candidate'`; a client `signature_verified:true` fails closed. No SDK client supplies a trusted verifier.
2. **AI-1 current Auth**: bind exact `brand_id/app_id/environment/event_id/actor_ref` to current member + session/auth_version, after verified issuer. A Billing Q2 member digest or stale token is not P05 authority. Revoked/deleted/unknown must deny normal notification; identity-revocation/deletion audit needs the matching *current* state.
3. **AI-3 Q104/Q119**: lawful purpose, consent, retention and erasure/legal hold require Owner-approved policy version. Both observations must still agree. A local boolean `lawful_now` is candidate evidence, not legal approval.
4. **AI-3 durable receipt/CAS/outbox**: only the AI-3 domain writer may claim `(brand,app,environment,event_id,idempotency_key)` with a unique durable transaction and stable digest. Two competing claims / changed claim revision / different `attempt_ref` must quarantine. Candidate `cas_state='committed_unverified_candidate'` cannot prove physical D1 atomicity.
5. **AI-0 independent anti-PITR witness**: must use genuinely independent storage/authority, stable commit/digest binding and monotonic floor immune to the same D1 restore. Same-ledger or rollback floor denies; metadata `external_unverified_candidate` cannot authenticate independence.
6. **AI-4 Queue ACK**: do not call unless authoritative D1 commit **and** independent witness **and** current Auth/retention **and** idempotent outbox have been verified within an approved transaction/safety protocol. Ack-before-commit, retry, duplicate and reorder fail closed. This module has no ACK method.

## New negative test coverage

16 executable Node tests cover frozen R002 source guards, consistent-mock still review-only, forged signature boolean, invalid KID/epoch/nonce/replay/digest, wrong actor/event/Session, late revoke and switch, member deletion lawful hold, Q104/Q119 drift/PII, idempotency/CAS/outbox tamper, simultaneous competing claim, out-of-order revision, same-ledger witness/PITR rollback, early/double ACK, all six upstream outages, cross-brand/prod/unsupported event, hostile getter/prototype and no side-effect method. All DTOs and fixtures are synthetic redacted metadata.

## Gate1 decisions requested — **options, not preselected approvals**

| Question | Pending explicit choices / evidence | Authority |
| --- | --- | --- |
| Canonical P05 issuer & KID | A: dedicated centrally signed envelope; B: domain-signed envelope under a single AI-0 registry; key custody, rotation, nonce persistence, digest canonicalization, replay window, revocation proof remain to be decided | AI-0 + AI-4, AI-1 for Auth event binding |
| Q104/Q119 lawful processing | Per event-class approved purpose, retention time, erasure/legal hold basis and notice preferences versus delay/deny; no default days or automatic deletion | Product Owner + AI-0/DEV-H |
| #87 D1 A/B | Pick domain-specific D1 segregation/atomic boundaries A or B **only with the original #87 authoritative detail reviewed**, migration/rollback and isolation tests; this proposal intentionally does not reinterpret A/B | AI-0 + Product Owner |
| Receipt concurrent CAS | Unique idempotency + atomic D1 transaction/outbox vs separately versioned receipt with conflict-resolution proof; test crash-before-commit, double claim, retries and recovery | AI-3, AI-0 Gate |
| Independent anti-PITR witness | A: externally independent monotonic witness; B: separately operated immutable external record; independence, retention, alert/reconcile and rollback recovery must be proven | AI-0, AI-3 |
| Queue ACK / cost | Verify real commit-before-ACK and no duplicate send in separately approved disposable staging, independent witness and DLQ recovery; resource scope, data classification, cost cap and explicit rollback required before any provider call | AI-4 + AI-0 + Product Owner |

## Gate and rollback

- **Gate1 PARTIAL/BLOCKED**: no approved canonical signer, actor-bound current Auth read port, lawful Q104/Q119 decision, physical CAS/witness or ACK protocol.
- **Gate2**: owner-branch offline GitHub Actions only, attributable to its exact final commit SHA; not R003/R004 four-owner integration, physical D1, actual Cloudflare Workers Build or live service.
- **Gate3**: G00–G10 11/11 BLOCKED, P05/PUBLISHABLE=false, release_authorization.granted=false; Cloudflare Workers Builds earlier independently FAILED.
- Entire interface remains synthetic/offline; `may_ack/may_send/may_retry/may_enqueue/may_write_d1/may_grant_battery/may_sell_battery/may_publish/live` permanently false.
- Battery forever FREE, no SKU, no paid grants. No main merge; no Preview/Staging/Production deployment, real D1/Queue/R2, Store/EAS/RevenueCat/AdMob initialization/ad requests, paid resources, H-Global or consumer App Repo.
- Rollback = close this R004 Draft PR/discard only its three new AI-3 paths. AI-0 #197, sibling Owner Drafts and all existing domain writers remain unchanged.
