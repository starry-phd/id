# AI-2｜Wave1 Round-001 Billing／RevenueCat 權益契約（離線候選）

**Status**: `CI only / Draft / no live Store`. Source: [AI-0 Round-001 Issue #1](https://github.com/starry-phd/id/issues/1#issuecomment-6466488372), [AI-2 #3](https://github.com/starry-phd/id/issues/3#issuecomment-6466176465), owner-decision JSON `docs/operations/ai0-owner-approved-wave1-decisions.v1.json` and v1.2 master Google Doc. AI-2 continues existing SBASE/R23 code without replacing it.

## Implemented

- Added versioned `starry.billing.wave1.review.v1-offline` domain-only source `src/wave1-billing-revenuecat-review.ts`, tests `test/wave1-billing-revenuecat-review.test.mjs`. Existing central Billing writer/DB, HTTP SDK/Store crypto, R23 preflight, Google RTDN verifier, Auth/Battery and AI-0 decision documents remain untouched.
- D03=A thin RevenueCat future adapter; permitted `NON_CONSUMABLE` buyout (permanent feature/optional ad-removal mapping) and `AUTO_RENEWABLE_SUBSCRIPTION` only `MONTH` / `YEAR`. Enforces optional per-App buyout, subscription or both with unique mock iOS/Android SKU and nonempty feature mapping. Explicitly rejects consumable / non-renewing, Battery and sticker/topup product keys.
- Q2=A pre-purchase server session is **not** established by this offline test fixture. `purchasePreflight` always blocks even if a candidate identity reads active. Auth session authority must be supplied by AI-1; anonymous browsing remains outside this module and free. No signed live session or RevenueCat identity mapping has been proven.
- Q1=A same App and Starry ID should get effective valid content rights across iOS/Android **subject to policy/real Sandbox**. Local candidate state is `review_only`; does not mean Apple/Google transactions transfer or actual entitled access. Any Android/iOS local record is treated as tentative; all grants, purchase, restore, ads-off, webhook ACK, live and publish booleans remain false.
- Q3=A subscription expired/refunded/revoked does not rewrite permanent nonconsumable candidate. Per product and platform highest local version wins; out-of-order older active cannot undo a newer refund. Identical event ref replay idempotent, conflicting duplicate ref or same source version different event blocked, foreign App/member/brand/environment denied.
- No raw receipt/payment token/member digest/Store SKU returned in evaluation DTO; public repo stores only synthetic fixtures. Cloudflare/Store/RevenueCat SDK/EAS/Ads/paid service not accessed or installed. **Starry Battery permanently free**. P05/PUBLISHABLE=false and G00–G10 remain BLOCKED.

## Dependencies / next handoff

- **AI-1 Issue #2**: define an approved server-verified Auth/Session binding for purchase preflight and account switch. This module's `offline_auth_fixture_only` must never stand in for official signed authorization.
- **AI-4 Issue #5**: publish app-scoped product catalog and thin RevenueCat BillingClient SDK interface/Status enum after actual native build and Store sandbox; no cross-App SKU import. Ads provider still OFF.
- **AI-0 Issue #1**: review app-level feature/entitlement mapping, D03 RevenueCat single authority, legacy R23 Billing source coexistence. Require real iOS/Android Sandbox refund/restore, webhook replay and cross-platform owner evidence before any positive grant; then integrate only original changed files with exact SHA and rerun same-checkout Gate.
- **ADMIN-PREP**: P01 AppRegistry/brand/app/env concept checked, P02 versioned DTO; P05 event delivery still blocked; P06 audit/retention and P08 cost/fees TBD. No second-wave admin permission or endpoint added.

Rollback: close Draft without database changes; no protected module writer, migration, main merge, real D1/Cloudflare, Store purchase or H-Global development.