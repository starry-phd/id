# AI-3 Wave1 Round-003｜Single P05 Server-only Port and commit-before-ACK Gate (DRAFT)

Status: **OFFLINE CANDIDATE / NOT A SIGNED AUTHORITY / NOT LIVE**. Parent AI-0 R002 integration [Draft #197](https://github.com/starry-phd/id/pull/197) at `4215bb23bacb709fe3a659a443782032e2a1d5fe`. Source changes exclusively in `packages/rebuild-ai3/**`. AI-3 issues #4; AI-0 Gate #1; AI-1 #2; AI-4 #5.

## Contract (version `starry.ai3.p05.commit-before-ack.r003.v1-candidate`)
Future **server-only** `R003AuthorityPorts` must be composed by an AI-0 approved trusted Worker, never passed as HTTP body, Query, app JSON, or client-supplied `signature_verified`. All inbound metadata uses existing AI-3 `AuditMetadata` candidate and `assertEvent`; this work does **not** define a second canonical P05 envelope or issuer. `R003_LIVE_ENABLED=false`, all side-effect capabilities permanently false in this candidate.

| Step | Domain writer/authority | Future proof requirements | Current state |
| --- | --- | --- | --- |
| 1 | AI-0 canonical P05 + AI-4 signed issuer transport | sign/verify issuer KID/rotation, canonical bytes, digest, event_id, actor_ref, brand/app/env, idempotency + replay scope | NOT APPROVED, no signer/verifier |
| 2 | AI-1 Auth | server-only current member/session/revocation: same event_id + actor_ref, current auth_version/session_version, deleted/unknown denied | no event-bound SessionFence; purchase identity is NOT valid substitute |
| 3 | AI-3 + AI-0 legal approval | Q104/Q119 lawful purpose, consent, erasure/retention and legal-hold version; no raw personal IDs in public audit DTO | owner decisions not signed off |
| 4 | AI-3 durable D1 transaction writer | event-id + idempotency unique CAS, event digest, committed receipt readback, commit revision; retry/replay must not duplicate | no real D1 write / no transaction proof |
| 5 | AI-0 independent safety witness / #87 | external-to-restored-ledger monotonic anti-PITR floor, actual signed/independent readback; #87 A/B authoritative choice | BLOCKED |
| 6 | AI-4 Queue transport | ACK **only after** true durable commit + independent witness + current Auth + legal policy; crash after commit before ACK is idempotent | no Queue binding/ACK; NOT AUTHORIZED |

## This Round-003 delta versus R001/R002
R001 `wave1-security-notification-fence` and R002 `wave1-r002-p05-audit-review` already deny notifications on revocation and re-check candidate P05/Auth/receipt/legal data twice. This R003 **adds distinct commit-before-ACK / independent anti-PITR evidence boundary** with explicit owner-owned ports and executable offline negative cases for acknowledged-before-commit, forged `signature_verified:true`, same-ledger fake witness, PITR revision rollback, receipt digest mismatch, post-commit Auth revoke, deletion/erasure retention mismatch and race. Reuses the *actual* R002 AI-3 and AI-4 contracts in test; does not modify/recreate them. Both snapshots are completely untrusted mock descriptors; even a fully consistent snapshot returns `review_only`, NEVER permission to ACK. This is **not** a proof of atomicity, KMS/issuer, legal policy or external witness.

## Acceptance and future Gate
- Node test: `node --experimental-strip-types --test packages/rebuild-ai3/test/wave1-r003-p05-ack-interop.test.mjs`.
- CI must be read at **this exact PR final head**; count GitHub Actions separately from external failed Cloudflare `Workers Builds: id-starry`. Official G00-G10 remains 11/11 BLOCKED; P05/PUBLISHABLE=false.
- AI-0: choose/approve single canonical signed P05 and #87 + anti-PITR independent witness / Q104/Q119; integrate only AI-3 immutable new blobs into next Gate candidate.
- AI-1: publish event+actor-bound current Auth SessionFence contract SHA; Billing identity bridge does not authorize P05.
- AI-4: approve server-only versioned OpenAPI/Queue transport contract **without registering route or ACK**, plus explicit isolated real-resource/cost/rollback Gate.
- AI-3: once approved source ports and isolated cloud resources exist, make separate reviewed staging proposal/negative tests; do not infer live readiness from this offline suite.

**Prohibitions:** no main merge, Cloudflare Preview/Staging/Production, real D1/Queue/Store/EAS, paid actions, H-Global, consumer private Monorepo or Ads. Battery is always FREE and never purchasable; no ledger/FEFO/grants are enabled. Rollback: close this Draft PR/ignore only its 3 newly added AI-3 paths, preserve #197 original SHA and all Owner writers.
