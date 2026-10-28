# AI-2 Wave1 R007 | Apple / Google / RevenueCat official-adapter **deny-only** review

## Authority and scope
- Owner activation: user explicitly said "開始第七輪" after AI-0 [Issue #1 R007 plan](https://github.com/starry-phd/id/issues/1#issuecomment-6475798580). Source-preserving R006 integrated [Draft #221](https://github.com/starry-phd/id/pull/221), exact base HEAD **5be61848f745cc17de449d773147b8a6a5b5b742**. Its Gate2 was OFFLINE ONLY, Gate1 PARTIAL/BLOCKED and Gate3 G00–G10 11/11 BLOCKED.
- AI-2 R006 [#218](https://github.com/starry-phd/id/pull/218) three immutable blobs already included in #221. **Do not rewrite them.** New R007 only adds AI-2-owned source/test/docs.
- New version: \`starry.billing.r007.official-provider-adapter-deny.v1-offline-candidate\`, default disabled. The adapter is a **review of metadata**, not an implementation of an official signature/token verifier, authorization decision or store/webhook client. Even a \`review_only\` result is unverified.
- The R006 fixture HMAC and the AI-0 P05 vNext HMAC are *different* from official Apple/Google/RevenueCat proof; neither may grant entitlements, turn off advertising or send P05. Never infer an actual purchase from claims named \`apple_jws_claim\`, \`google_developer_api_claim\`, \`revenuecat_webhook_claim\`, \`verified:true\` or client callbacks.

## Three verification boundaries to implement only after separate approval

| Source | Future official authority and mapping (NOT integrated) | Offline fail-closed rules |
| --- | --- | --- |
| Apple StoreKit / App Store Server | Verify Apple signed JWS using Apple's documented certificate/signature validation and app/environment/product/transaction lineage, refund, revocation, subscription status and notification semantics. Server transaction claims are not trusted until verified against actual Apple authority. | \`apple_jws_claim\` is **review_only**; notification-only claim is blocked; iOS only; app/SKU mismatch, duplicate, rollback, refund→restore all denied. |
| Google Play Developer API / RTDN | Validate purchase token by authenticated Google Play Developer API for the correct package/SKU/entitlement, acknowledgement, purchase/subscription state and refund or voiding evidence. RTDN receipt alone is notification, not payment verification. | \`google_developer_api_claim\` remains **review_only**; \`google_rtdn_claim\` explicitly blocked; Android only; cross-OS and order replay denied. |
| RevenueCat | Authorize RC project/app and server-owned App User ID mapping; verify webhook authentication via the actual chosen integration and reconcile against trustworthy Store/RC customer records. Store and RC authority conflict policy must be approved, not silently dual-write. | \`revenuecat_webhook_claim\` is **review_only** on both OS; arbitrary App User ID / fake secret/header cannot grant or restore. |

## Security and entitlement matrix
1. Strictly scoped \`starry\` development/staging + unique per-app product keys and different iOS/Android SKUs; buyout, MONTH and YEAR are distinct. Reject H-Global, Battery and consumable/top-up product candidates.
2. Accept only plain own data-only structured metadata with exact keys, with no getters, prototype pollution, unexpected \`verified\` / entitlement flags, member email, token or secret; outputs redact member digest, source event and transaction identifiers.
3. Reject forged provenance/platform, Apple notification only, Google RTDN only, cross app and cross OS SKU, replay event IDs, stale/equal source_version, transaction transfer across platforms/members, refund/revocation followed by restore/renewal, future timestamps and provider outage. Distinct genuine subscriptions and renewal status will later require vendor-specific status semantics, which this offline mock does not supply.
4. The in-memory \`Set/Map\` is **testing instrumentation only**. It is neither transactionally durable D1 CAS, server entitlement ledger, replay evidence surviving PITR, nor an independent durable witness. The mock cannot implement the real cross-OS same-App entitlement rule or refund accounting.
5. Cross-platform member continuity needs AI-1 **current signed Auth/Session** and explicit store account binding; R007 does not create or verify it. Future successful content access may be scoped to the same app/member after independent verified receipts but must **not transfer the Apple/Google order** between operating systems.
6. All operational permissions are hard false: \`can_purchase\`, \`can_restore\`, \`can_grant\`, \`can_remove_ads\`, \`can_ack_webhook\`, \`can_send_p05\`, \`can_publish\`, \`ads_enabled\`, \`live\`. This also prevents the free Starry Battery from becoming paid credit. No real RevenueCat App User ID, keys or webhook have been accessed.

## Required approvals still missing
- Named Apple Bundle IDs, Google package IDs, Store product identifiers and price/policy; RevenueCat app/project identity and dedicated identity strategy. Never reuse a real client secret in a public repository.
- Store test account/credentials, real vendor verification/restore/refund integration, native development build and actual Sandbox device testing approval, explicit cost cap, staff owner and incident rollback.
- Q104/Q119 lawful purpose, retention/deletion and refunds; #87 A/B actual cross-D1 placement; AI-1 monotonic signed Session; authoritative durable D1 CAS/outbox with **independent anti-PITR witness**; AI-0 KMS/issuer; AI-4 protected Worker and Queue ACK only after verified commit.
- AI-0 Gate1/3 and legal/financial release authority. Cloudflare external check of #221 failed and remains separate from offline GitHub Actions. Q4=A AdMob Mediation is a supplier selection only; **Ads OFF**. No H-Global implementation; Expo54 unchanged; no private consumer Monorepo.

## Test evidence and rollback procedure
- The R007 additions are **three new paths** under \`packages/rebuild-billing/\`; all existing AI-0/1/3/4 and original R006 files are intentionally untouched. R007 tests execute in the Node TypeScript-strip test runner used by existing Billing GitHub Actions.
- Exact commit SHA, Git Blob SHAs, original full CI run URLs and independent Cloudflare result must be captured **after** actual execution. A Draft PR with passing synthetic tests does **not** raise Gate1/3, authorize payment or indicate successful Cloudflare deployment.
- Roll back by closing this R007 Draft and discarding its three added files. The parent #221, all R006 original Owner PRs, main and all external services remain unchanged. Do not merge, deploy, modify Cloudflare, touch genuine Store/RevenueCat/D1/Queues/EAS, turn on Ads or incur deliberate fees.
