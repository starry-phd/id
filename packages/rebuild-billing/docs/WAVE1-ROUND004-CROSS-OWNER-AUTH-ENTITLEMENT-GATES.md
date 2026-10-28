# AI-2 Wave1 Round-004 — current Auth / Billing continuity and Sandbox gates

Authoritative dispatch: https://github.com/starry-phd/id/issues/3#issuecomment-6474002181
AI-0 program: https://github.com/starry-phd/id/issues/1#issuecomment-6473979811
Last common four-owner integrated source is AI-0 R002 Draft #197 HEAD 4215bb23bacb709fe3a659a443782032e2a1d5fe. The four R003 Owner PRs #198/#200/#199/#201 are independently successful but NOT yet integrated by AI-0. AI-2 R004 is stacked on own R003 Draft #200 HEAD 051852a411b138ba45212c5a019484eb2c9dde81. Never silently import other owners' sibling code.

## What this increment actually implements

The new candidate starry.billing.r004.entitlement-continuity.v1-candidate performs a single per-App buyout/month/year product review using the already-present REAL AI-2 R003 unverified Store inspector for each SKU. Before and after each Store read it requires the SAME private AI-1 signed_auth_d1_review_only identity, session binding, App, environment, HMAC KID/epoch and Auth version. A revocation, switch, KID rotation, malformed event, wrong platform/SKU, or failed Auth read BLOCKS the whole matrix; no partial grant. The port does not mint synthetic identity, convert to offline_auth_fixture_only, expose digest, verify Store payments, write Billing D1 or accept a provider webhook.

Observations are diagnostic only: unverified_active / expired / revoked. An expired/refunded month/year subscription cannot cancel an independent active non-consumable buyout. Every public can_start_purchase, can_restore, can_grant, can_regrant, can_remove_ads, can_request_ads, can_ack_webhook, can_publish, live flag stays false. Battery never becomes a paid SKU. Latest Q4=A selects Google AdMob Mediation (Google technical v1.3); selection is NOT activation: adsEnabled=false, adsSdkInitialized=false, adRequestsEnabled=false. A feature ads_free is ONLY a review candidate, never ad suppression.

## Real-source cross-owner test dependency — must label SKIP, not PASS

The test source contains a conditional executable import of AI-1's ACTUAL R003 #198 file (modules/starry-id-v1/src/wave1-round003-identity-authority-port.ts). Once AI-0 source-preserves that original sibling blob in a NEW integrated checkout, the test runs genuine WebCrypto-signed Session + current SQLite Auth Member/Session/provider, AI-1 identity port, AI-2 R003 and R004, and revocation denial. Because the original #198 is absent on the isolated AI-2 R004 owner branch, the test is SKIPPED (cross-owner Gate remains BLOCKED). Owner CI green must never be represented as actual R003 cross-owner Auth verification. Other tests execute the actual AI-2 R003 reviewer with an explicitly structural offline Auth test double.

## Candidate outcome table (no real entitlements)

- NON_CONSUMABLE active: permanent unverified_active; cannot grant until official receipt validation and durable owner state.
- MONTH expired and YEAR refunded: subscription expired/revoked; cannot revoke unrelated permanent buyout.
- Wrong App/brand/env or account/session switch, revoked Session, changed KID/epoch: BLOCK whole matrix.
- Same App iOS/Android: distinct Store SKU/source; content entitlement transfer only after official Apple/Google policy and two-device sandbox proof, never move Store orders.
- App A != App B: no cross-App paid rights. Q4=A Google AdMob Mediation, Ads OFF; ads_free candidate never initializes SDK or sends ad request.

## Future real Sandbox acceptance requirements — NOT performed

1. Obtain specific human approvals and budgets for genuine Apple/Google Store test accounts, test SKU, RevenueCat project/SDK, native dev builds and devices, App Store Server API/Notifications v2, Play Developer API/PubSub, secrets/least-privilege scope, privacy and rollback. No actual fees, real credentials, Store or EAS operations allowed today.
2. AI-0 Gate1 must approve sole AI-1 current signed Auth HMAC JSON identity, nonextractable key custody and rotation, KID/epoch, Q104/Q119 lawful processing/retention. Never promote AI-2 legacy NUL/offline_auth_fixture_only.
3. Verify Apple signed transaction/JWS and Google Play Developer API token plus bundle/package/SKU/owner, RevenueCat trusted App User ID and webhook provenance, renewal, refund, cancel, grace, hold, restore, expiry, source version reordering and replay. Transport PubSub JWT alone does NOT prove a Play purchase.
4. Durable Starry Billing writer D1 CAS/inbox/outbox and independent anti-PITR, AI-3 signed P05/audit retention and AI-4 protected OpenAPI/Queue ACK-after-commit are future reviewed work; no actual handler, D1, Queue, provider or ad SDK exists in this increment.
5. Exact integrated SHA tests, dual iOS/Android Sandbox acceptance, physical Cloudflare independently repaired build, official 11 release Gates and human release authorization before any later main merge or deployment.

## Ownership, Gate and rollback

AI-0 #1 must integrate original AI-1 #198, AI-2 #200 plus R004, AI-3 #199, AI-4 #201 and updated Q4 decision #202 under ONE new AI-0-controlled integrated SHA, rerun real conditional Auth interop and same-SHA offline CI. AI-1 owns Auth, AI-2 Billing, AI-3 P05 and AI-4 protected APIs. Gate1 remains PARTIAL/BLOCKED until approved; Gate3 G00-G10 11/11 BLOCKED, P05/PUBLISHABLE=false, release_authorization.granted=false. Existing Cloudflare Workers Builds failure remains separate. Rollback closes only new AI-2 R004 Draft (three ADDED-only files), leaving #200 and #197 intact. No main merge, Production/Preview/Staging, physical D1/Queues, Store/RevenueCat/AdMob/EAS, paid operation, Ads ON, H-Global, external App or private consumer Monorepo. Battery FREE, central Expo54 unchanged.
