# AI-2 Wave1 Round-005｜Same-App dual-OS genuine signed Auth + unverified Store candidate gate

## Authority and immutable base
- [AI-0 #1 R004 Gate](https://github.com/starry-phd/id/issues/1#issuecomment-6474433288); [AI-2 #3 R005 official work order](https://github.com/starry-phd/id/issues/3#issuecomment-6474449510).
- EXACT BASE: [AI-0 integrated R004 DRAFT #208](https://github.com/starry-phd/id/pull/208) SHA **88b53f63e909798803d51b6f62cf2461e24ab690**; original R004 Billing [#207](https://github.com/starry-phd/id/pull/207) is already imported there, NOT to be reimplemented or cherry-picked.
- Gate2 is only *offline same-checkout* PASS on #208; Gate1 PARTIAL/BLOCKED; G00-G10 11/11 BLOCKED; P05/PUBLISHABLE=false; no real Store/Apple/Google/RevenueCat, D1 physical writer, KMS, AI-3 signed P05 or published Worker.
- Cross-owner code remains in AI-0 integrated base; do not modify/duplicate AI-1/3/4 source or Gate documents.

## What R005 actually tests and implements

**Candidate:** `starry.billing.r005.cross-os-signed-auth-review.v1-candidate`. A deny-only, per-App/evironment cross-platform **content-rights observation**, no Store sale or restore API.

- Tests import AI-1's genuine R003 `createOfflineR003IdentityAuthorityPort` and real `signServerSession` from integrated #208. In **SQLite :memory:** set up one current central user with two separate active sessions on two OS devices. Sign each test bearer with ephemeral nonextractable WebCrypto HMAC key; AI-1 checks valid signed bearer + live Member/Session/Provider and emits private, single-use `signed_auth_d1_review_only` JSON-HMAC member digest/KID/epoch (NOT AI-2's incompatible NUL/fixture identity).
- AI-2 R005 composes actual imported R004 per-App buyout/month/year inspector, which itself uses real AI-2 R003 per-SKU unverified Store probe, and refreshes the **same genuine AI-1 private identity** for both OS before, after iOS product inspection and after Android product inspection. Same signed central member digest + app/env + key epoch required; distinct OS Session bindings are allowed *within their own respective valid sessions*. Current Session revocation, member change, source rotation or product conflict fails closed for **both**.
- iOS/Android SKU values and synthetic Store observations remain separate. *Never* transfer Apple/Google orders or receipt; same central member is not an official RevenueCat App User ID; no official signed Store provenance has been checked. Separate permanent buyout and monthly/yearly subscription never grant or revoke each other due to refund/expiry. Observation labels `unverified_active|expired|revoked|none` are not actual entitlements.
- Q1=A future same-App cross-platform paid **content** direction is still pending official Apple/Google policy + RevenueCat sandbox validation. Per-App consumer rights cannot cross App A/B. Q2=A signed login before purchase; Q3=A only non-consumable buyout plus renewable month/year; Q4=A Google AdMob Mediation selected but Ads OFF; Q5=B private App repo later.
- Any reviewed ads_free feature is **candidate only**; SDK/AdUnit/ad request/removal of ads all remain false. Battery FREE and cannot be a Billing SKU.
- All operational and provider flags FALSE: can_open_store/purchase/restore/grant/regrant/remove_ads/request_ads/ack_webhook; official_apple/google/revenuecat_verified=false; durable_cas_verified=false; anti_pitr_verified=false; live=false.

## Expected offline acceptance / negative matrix

| Case | Actual test source | Only allowed result |
|---|---|---|
| Two signed, separately scoped device Sessions for same App and same member | AI-1 real WebCrypto + SQLite CURRENT reads; AI-2 R003/R004/R005 | review_only candidate; all grants false |
| Android signed Session from another central member | AI-1 provider + member digest differs | BLOCK before any Store probe |
| Guest, forged client bearer, wrong app/env | Real AI-1 unsigned/wrong signature/current Session | BLOCK |
| iOS or Android Session revoked during an unverified Store read | Actual SQLite UPDATE + rereads | BLOCK all observations; no partial grants |
| Member suspended/provider disconnected, Auth version increment | Real Auth D1 SELECT checks | BLOCK |
| Key KID/epoch rotation within two-device review | Injected nonextractable key lease version | BLOCK |
| Synthetic Store status refunded/expired, monthly/yearly, permanent buyout | Existing R003/R004 inspector | Independent review candidates, no entitlement |
| Invalid SKU, source revision, malformed source/payload, Store outage | Existing R003 strict untrusted probe validation | BLOCK or unverified; never apply rights |
| Same App feature ads_free, AdMob vendor Q4=A | AI-2 R005 + R004 | Ads remain OFF; no SDK/ad requests |
| Production or H-Global scope, unsupported paid Battery product | Strict server scope / existing SKU plan checks | BLOCK |

## Human approval and future Store Sandbox matrix: NOT EXECUTED

1. **Gate1 identity/legal:** AI-0 single authoritative HMAC/KID and rotation, key management/least privilege, purpose-bound cross-platform member key, AI-1 proof custody; human approval of Q104/Q119 lawful retention. No user ID from UI, no Store SDK until approved.
2. **Explicit costs and third-party access:** Owner must separately approve exact Apple/Google sandbox, RevenueCat project, StoreKit2 / App Store Server JWS+Notifications v2, Play Billing / Developer API and RTDN, native test app IDs, package/sandbox credentials, EAS builds/devices, privacy policy and budget caps with rollback. None are created/installed or charged by this R005.
3. **True receipt and user mapping:** Independently verify official signed Store data and backend RevenueCat App User ID, distinguish entitlement from purchase order, verify app/package/bundle+SKU+environment+original transaction and ownership, provider event dedupe with durable CAS before grant, Apple/Google refunds, renewal/grace/hold/cancel/restore, identity rotate/revoke, server webhook authentication (PubSub JWT by itself != verified Google purchase). No official source attested in R005.
4. **D1/PITR/Queue:** Only post-approval durable Billing CAS/outbox, AI-3 lawful P05 signed receipt and independent anti-PITR, AI-4 canonical ACK-after-commit can authorize future operation. Source version Map in R003 is volatile test instrumentation, not durable dedupe or anti-PITR.
5. **Release:** New exact-SHA AI-0 cross-owner integration CI, iOS+Android native Store Sandbox, Cloudflare external Check, 11 signed G00-G10 gates and human release approval. Do not conflate GitHub offline green with physical Store or Cloudflare.

## Handoff / safety

R005 must remain AI-2-only 3 ADDED files on a new ai2/* Draft based directly on AI-0 #208. Document exact original blob SHA, parent HEAD, same final-SHA full GitHub Actions status including all failed/skip tests, Gate1/2/3 results and rollback. AI-0 imports these original Git blobs in next NEW integrated SHA, reruns both genuine signed-Auth+Store synthetic tests and owner Gate. The old R004 AI-2 PR #207 and AI-0 #208 must stay unchanged.

Rollback: close R005 Draft and remove only new three files. No main merge, paid resources, real App Store/Google Play/RevenueCat, live Billing Store webhook/restore/grant, Production/Preview/Staging, live D1/Queues/Cloudflare/EAS/AdMob, secrets, user data, Ads ON, H-Global/繁星回聲 or new private consumer Monorepo; central Expo54 unchanged, Starry Battery permanently FREE.
