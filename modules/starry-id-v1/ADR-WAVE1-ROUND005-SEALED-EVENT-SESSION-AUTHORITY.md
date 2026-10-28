# AI-1 R005 — Sealed candidate P05 envelope + current Auth SessionFence (OFFLINE, DEFAULT OFF)

Formal order: [AI-0 #1 R004 integrated Gate](https://github.com/starry-phd/id/issues/1#issuecomment-6474433288), [AI-1 #2 R005](https://github.com/starry-phd/id/issues/2#issuecomment-6474448325). All other Owner work remains unchanged. Safe base is AI-0 [R004 integrated Draft #208](https://github.com/starry-phd/id/pull/208) HEAD \`88b53f63e909798803d51b6f62cf2461e24ab690\`, already source-preserving R001–R004.

## Exact incremental contract

- New \`starry.auth.p05-envelope-r005.v1-offline-candidate\`; \`R005_ENVELOPE_AUTH_LIVE=false\`. New \`createOfflineR005SealedEventSessionAuthority\` accepts only trusted server DI, not front-end signed/verified booleans.
- Exact own-data-only 15-property candidate envelope, plus a lowercase 32-byte HMAC-SHA256 MAC; domain-separated canonical bytes. Strict brand=Starry, App/env, \`event_id\`, \`actor_ref\`, event type, \`auth_version\`, \`session_version\`, issuer KID/epoch, nonce, issued/expires with **max 60-second** validity. Reject extra keys, accessors, prototype pollution, malformed signature or duplicate IDs.
- **Verification happens BEFORE any Auth D1 read**, with actual WebCrypto \`subtle.verify\` against server-injected nonextractable HMAC key, requiring stable \`kid\`, epoch and key object before/after, and again at the second check. Only approved-looking producer object cannot pass without a valid MAC. Test-only ephemeral signing key is generated inside tests; **no real AI-0 canonical P05 issuer or KMS exists or is implemented** here.
- Delegates actual current member/session/provider + R003 signed Auth/SQLite + R23 sealed signed Session, two-pass scope+actor current version checking to unmodified **AI-1 R004 source**, itself inherited unchanged in #208. Server-only \`resolveEventActor\` and \`readSessionEpoch\` remain injected pending physical Auth binding; in-memory synthetic monotonic session epoch table is only a disposable test fixture. \`starry-id-v1/schema/001_starry_identity.DRAFT.sql\` lacks persistent \`session_version\`; no D1 migration or writer is made.
- A bounded in-process event_id replay denial prevents local copies and different actor bound to same event; event is conservatively consumed even on rejected Auth check. This **is not durable replay idempotency, independent anti-PITR witness or atomic D1/Queue claim**. Process crashes/replicas and late revoke after last read remain unclosed; therefore no P05 ACK/send.
- Public view is fully redacted; single-use private WeakMap review only returns purpose-limited versioned candidate metadata. All send/Queue ACK/grant/charge/publish/live flags always FALSE. New Auth→Billing DTO remains **type-only reference to R003** \`signed_auth_d1_review_only\`, \`ai1.r002.json-hmac.v1\` app/env/purpose/KID; no silent AI-2 \`offline_auth_fixture_only\`, NUL digest or P05 proof as Billing issuer.

## Gate1 unresolved (AI-0 is authority)

1. AI-0 and AI-4: sole canonical P05 signed issuer/envelope schema, KMS key custody, actual KID rotation/revoke policy; simulated HMAC is NOT certified or live.
2. AI-1: physical monotonic Auth \`session_version\` / CAS version, event/actor server mapping and deletion revocation source; no physical binding in this PR.
3. AI-3: Q104/Q119 lawful purpose/retention, durable P05 CAS receipt/outbox, cross-resource independent anti-PITR and real commit-before-Queue-ACK with late-revoke semantics.
4. AI-2: app/environment-specific current signed Session+member identity and actual Store/RevenueCat receipts are independent. \`R005BillingIdentityBoundaryProposal\` is **type only** and cannot grant entitlements.
5. AI-4: protected POST/SDK error route remain unregistered; existing Worker only GET /v1/health. Cloudflare external build for R004 same SHA **UNVERIFIED**; an older different SHA had Cloudflare preview failure, not changed here.

Release: Gate1 PARTIAL/BLOCKED, Gate2 only offline PASS on AI-0 #208, Gate3 G00–G10 11/11 BLOCKED, P05/PUBLISHABLE=false. Ads provider Google AdMob Mediation Q4=A but Ads OFF, SDK absent; Battery FREE. No main merge, Preview/Staging/Prod, real D1/R2/Queue/Secrets, Store/RevenueCat/EAS, AdMob, charges, H-Global, private Consumer Monorepo or existing Expo54 upgrade. Rollback close R005 Draft and remove **only three new AI-1 owned files**; AI-0 #208 remains immutable.
