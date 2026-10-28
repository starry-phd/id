# AI-2 Wave1 Round-003 — canonical Auth→Billing / Store candidate (OFFLINE ONLY)

Parent: AI-0 integrated Draft #197 HEAD `4215bb23bacb709fe3a659a443782032e2a1d5fe`.
Dispatch: https://github.com/starry-phd/id/issues/3#issuecomment-6471175859
AI-1 R003 candidate: Draft #198 HEAD `e81788d2e0f2a08eb0bf1d6f9beccbe3dfb1a367`.
Owner: AI-2 / DEV-B; Gate1 review authority: AI-0 #1.

## New exact scope

- Introduces `starry.billing.r003.auth-store-fence.v1-candidate` in AI-2-owned src/test only, not a new Billing writer or production SDK. Structural server-only input matches AI-1 #198 `createOfflineR003IdentityAuthorityPort` / `signed_auth_d1_review_only`. It explicitly refuses the incompatible AI-2 R002 `offline_auth_fixture_only` + NUL HMAC mapping. AI-1 #198 itself is NOT copied or imported on this #197-based owner branch; actual cross-owner runtime interop is pending AI-0 integrated Gate1.
- Checks THREE fresh one-time AI-1 private Auth reviews before/after reading local untrusted Store fixture. Requires same member HMAC digest, session binding, app/brand/env, auth version, digest KID/epoch, active session and expiry. Account switch, Session revoke, rotation and Auth outage fail closed; no digest/member/session in public response. No generated member digest or weakly re-labeled fixture.
- Untrusted Store probe is diagnostic only: strict per-App, per-environment, per-OS SKU, member binding and local source_version/refund validation. In-memory replay/rollback fence is intentionally NON-DURABLE and never qualifies as a real Store/D1/anti-PITR authority.
- Q2 trusted Starry ID before eventual purchase; Q1 same App content rights across iOS/Android remains Store-policy/sandbox-dependent, not cross-Store transaction transfer; D07 no cross-App entitlements. D03 only NON_CONSUMABLE buyout, AUTO_RENEWABLE_SUBSCRIPTION month/year; expired subscription cannot revoke unrelated valid permanent purchase. Ads OFF and Starry Battery permanently free.
- All outputs permanently `can_start_purchase/can_restore/can_grant/can_remove_ads/can_ack_webhook/can_publish/live=false`, and `official_store_verified/official_revenuecat_verified=false`. No live Store, RevenueCat, webhook signer, receipt validation, D1, Queue ACK, new HTTP route, Cloudflare config, EAS, funds, secrets, production, main merge, H-Global or external consumer App.

## Local security tests

14 standalone executable Node tests cover default OFF, signed Auth candidate shape/triple current rereads, fake UI principal, tampered proof, cross-brand/app/env, revocation/member switch while Store is read, KID/epoch rotation, per-platform product SKU, cross-OS review only, rollback and contradictory refund, expired subscription distinct from buyout, Store/Auth/clock outages, malicious getters, unsupported consumable/Battery and duplicate SKU. Tests inject a **structural offline AI-1 Port test double**; they DO NOT run the actual AI-1 #198 code, official Store SDKs, or a live signed Store Sandbox. Exact commit SHA and same-HEAD Actions evidence must be provided in PR/Issue after execution.

## Apple/Google/RevenueCat Sandbox future acceptance matrix — NOT EXECUTED

| Future scenario | Required authoritative proof | Authorization/blocker |
| --- | --- | --- |
| RevenueCat App User ID | Server-only Starry member per-App/env mapping; KID rotation; no anonymous collisions or UI digest | AI-0 canonical issuer + legal Q104/Q119 + AI-1 KMS custody |
| iOS buyout | Real StoreKit sandbox signed transaction, Apple Server API / Notifications v2, bundle/product/ownership/refund verified | Apple tester, SDK development build, authorized credentials |
| Android buyout | Play Billing test purchase token + Play Developer API package/product/owner verification; Pub/Sub JWT alone insufficient | Google tester / least privilege API / signed test build |
| Month/year | Real auto renew, cancel, grace, hold, expire, refund/revoke, restore with correct app SKU | Dual Store sandbox products + RevenueCat licensed/test project |
| Cross-iOS/Android | Same valid Starry ID content entitlement, separate authenticated Store orders; user switch and other App denial | Apple/Google store-policy review + real two-device sandbox |
| Webhook/D1/P05 | Verified upstream Store authority, RevenueCat webhook provenance, durable CAS/idempotency, signed P05 event issuer, commit-before-Queue-ACK and independent anti-PITR witness | AI-2/3/4 protected routes, physical isolated D1/Queues, explicit owner approval |
| Build/release | Exact-SHA CI, real Cloudflare Preview/Build, two native development builds, E2E, rollback and G00–G10 | Separate per-cost approval; Gate3/release authorization |

Every row is **BLOCKED** until its real test evidence exists. Provider credentials, Store SKU, App User ID binding and funding are not yet authorized.

## Gate / owner handoffs

AI-0 #1 must decide the single canonical signed Auth→Billing authority: AI-1 R002 JSON HMAC vs AI-2 legacy NUL fixture are NOT equivalent. Confirm legal purpose/retention Q104/Q119, KID rotation/key custody and current Auth revalidation; owner of verified RevenueCat App User ID, provider receipt evidence, source version and D1 writer. AI-4 #5 owns protected OpenAPI/Worker routes and AppRegistry; AI-3 #4 owns P05/audit/retention. AI-2 owns digital Billing only. A new AI-0 four-owner integrated SHA must test the actual AI-1 R003 Port with this code before any Gate1 upgrade; owner's test double CI is not this acceptance.

P01 App/brand/env/SKU scope checked; P02 protected endpoint is **unregistered**; P03/P04 no admin/refund action; P05/P06 no real event/ACK; P07/P08 no live metrics or revenue; P09 GitHub evidence in PR/Issues; P10 candidate enabled only explicitly in offline tests, never live. Gate1 PARTIAL/BLOCKED, Gate2 #197 R002 offline PASS only; Gate3 G00–G10 11/11 BLOCKED, P05/PUBLISHABLE=false, release_authorization.granted=false. Separate Cloudflare Workers Builds failure remains. Rollback: close new Draft and remove ONLY the three new AI-2 files; original #197 remains intact.
