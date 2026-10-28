# AI-2 Wave1 R008｜Apple／Google × RevenueCat 雙來源衝突與訂閱狀態保護（離線／拒絕）

## Source of truth and task authorization
- User explicitly activated AI-2 eighth round. At kickoff, AI-0's R007 four-owner source-preserving [Draft #226](https://github.com/starry-phd/id/pull/226) **766ee89cc9991d8c17c6f610e6bdbbdb4aa78172** was all-owner exact-SHA offline PASS; AI-0 R008 Cloudflare Preview OFF audit/governance [Draft #227](https://github.com/starry-phd/id/pull/227) **aecdee944158b40ffbbd129ddd126136687d7652** was already exact-SHA offline PASS. **The AI-2 R008 branch inherits #227 unchanged**, including R007 AI-2 source [#223](https://github.com/starry-phd/id/pull/223). This is a new AI-2 owner-only OFFLINE change, NOT a claim that AI-0 assigned broader R008 work to the other Owners.
- Cloudflare Starry \`id-starry\` previously received user authorization to disable *automatic Preview Builds only*; its actual \`previews_enabled=false\` and \`auto_build_enabled=false\` were confirmed by AI-0. No Cloudflare calls or modifications are part of AI-2 R008. Old failed Preview checks remain historical failures.
- \`starry.billing.r008.cross-provider-conflict-deny.v1-offline-candidate\` is **default OFF**. The only input is an explicitly untrusted pair of R007 \`review_only\` objects and synthetic claimed correlation metadata. It does **not** read authentic Apple/Google/RevenueCat receipts, JWS certificates, Play APIs, webhook signatures, RevenueCat CustomerInfo/App User IDs, actual Auth or persistent D1.
- R007 has **zero official verifier**; receiving two separately plausible R007 \`review_only\` results can never magically establish receipt authenticity. The R008 review cannot assign a purchased or restored entitlement. R008 checks a *hypothetical contract*, not a connection to real Store/RevenueCat.

## Cross-source decision matrix (all safe outcomes)
| Test-only Store source | Test-only RevenueCat source | Diagnostic result | Mandatory business outcome |
| --- | --- | --- | --- |
| Apple or Google "purchase" | RC "purchase" and same *claimed* member/order hash | \`review_only\` matching unverified claims | **NO GRANT / NO PURCHASE / NO RESTORE** |
| Store "renewal" | RC "renewal" | \`review_only\` unverified renewal | **NO ENTITLEMENT** |
| Store purchase | RC refund/revoke | \`blocked\` | no grant/restore; defer to genuine authoritative revocation |
| Store refund/revoke | RC purchase/restore | \`blocked\` | never resurrect a refunded order |
| Store expire/grace | RC active/renewal | \`blocked\` | no optimistic entitlement |
| Store purchase/renewal | RC event disagrees | \`blocked\` | independent reconciliation needed |
| Store restore | RC restore | \`blocked\` | requires official lineage, server Auth and durable order authority |
| Store vs RC different member digests | any | \`blocked\` | no app-user-id relinking from client claim |
| Store vs RC different original-order digests | any | \`blocked\` | no cross-order transfer |
| Apple with Android / Google with iOS correlation | any | \`blocked\` | cross-platform Store orders not transferable |
| Wrong app/brand/env/product, malicious getter or extra \`verified:true\` | any | \`blocked\` | reject untrusted input |

Two providers' internal \`source_version\` values are **incomparable domains**: never interpret \`store_version > rc_version\` as proof that Store is newer. The R008 offline candidate does NOT promise a final ordering policy for delayed vendor webhooks or in-flight refunds; only a real, approved per-source event ledger and independent authority can make that decision. No actual cross-App entitlement, native purchase or refund side-effect is implemented. Buyer-out, month and year remain distinct per-app products in inherited R007, not automatically conferred by R008.

## R008 contracts, testing and trust limits
- Source: \`packages/rebuild-billing/src/wave1-r008-cross-provider-conflict-deny.ts\`; tests: \`packages/rebuild-billing/test/wave1-r008-cross-provider-conflict-deny.test.mjs\`. Exact R007 field whitelist and all operational false flags are verified via data-only own-property descriptors; no client or prototype/getter may substitute real proof.
- The sample member and original-order \`m_*\` / \`o_*\` hashes in fixtures are **synthetic correlation assertions**, not Apple original transaction identification, cryptographic evidence of account ownership, RevenueCat App User ID authorization or true account transfer. They never appear in the returned review.
- All results hard-code **false**: \`correlation_is_authoritative\`, official Apple/Google/RC verification, RC App User ID authorization, current signed Auth, durable CAS, independently durable anti-PITR, purchase, grant, regrant, restore, remove ads, send P05, ACK, publish, ads enabled, live. Even a successful pair yields \`status=review_only\` rather than approved entitlement.
- The implementation is stateless; no network, test HMAC signer, secret, receipt, D1 read/write, Queue, iOS/Android SDK, durable write, refund, product purchase or ads request. No changes to R006/R007 original Owner Git blobs, AI-0/1/3/4 writers, Wrangler, workflows, main or production.

## Unresolved prerequisites before any real payment work
1. Authorized official Apple StoreKit/App Store Server JWS verification and Google Play Developer API purchase-token verification with package/bundle/SKU/account/transaction-scoped security; RC project account mapping and webhook replay/signature authority. RTDN/Apple notification alone is not purchase proof.
2. AI-1 genuine *current* Auth+Session and RC App User ID mapping; AI-3 real durable D1 transaction CAS/outbox/anti-PITR witness, refund and cross-source idempotency; AI-0 canonical issuer/KMS, policy Q104/Q119, physical D1 choice #87; AI-4 protected Worker/commit-before-ACK. All must be approved and independently tested.
3. Human-approved Store/RC Sandbox accounts, SKUs, bundle/package identifiers, secret custody, test-device/EAS budget, privacy and refunds, security/rate limits/incident rollback, real Cloudflare isolated preview settings and explicit release authority. **None are approved by "開始第八輪".**
4. Gate1 **PARTIAL/BLOCKED**, Gate3 **G00–G10 11/11 BLOCKED**, \`P05/PUBLISHABLE=false\`, Ads OFF despite Q4=A AdMob selected, Starry Battery permanently FREE, Expo54 unchanged, H-Global development paused. Gate2 is a **CI result only**, never a release approval.

## CI, handoff and rollback
The three R008 AI-2-owned additions (source/test/this document) are not an upstream main merge or a real Store verifier. Obtain and cite the new R008 **exact HEAD** GitHub Actions jobs, test totals, and original immutable Git Blob SHAs *after* execution, and report any Cloudflare external check independently. The upstream #227's offline PASS must not be misrepresented as R008 evidence. For rollback, close the R008 AI-2 Draft and discard only three new R008 files, preserving the AI-0 #227 base, the #226 R007 integration, original Owner Drafts, Cloudflare Preview OFF, and main untouched. No deploy, fees, true Store/RC, real D1/Queue, Ads or H-Global.
