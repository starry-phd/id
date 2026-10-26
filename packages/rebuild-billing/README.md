# Starry Rebuild BILL-001｜AI-2 Sandbox v0.1

**DRAFT ONLY / NO real IAP, D1, refunds or entitlement issuance.**
Source: [AI-0 PR #25](https://github.com/starry-phd/id/pull/25) SHA `f9c02e2350fc1cf0311574ac05c3536d9b2900f5`; `BILL-001=approved`, `BILL-002=candidate`, `coverage=seed_only`. Old PR #23 is historical; **not imported**.

## Delivered
- `src/index.ts`: typed server-only Starry Auth + Apple/Google provider **ports** (not implementations), allowlisted Sandbox SKUs, Starry-only app/runtime/store verification, owner binding and entitlement projection (renewal, refund, chargeback, hold, grace), SHA-256 stable idempotency key + minimal outbox proposal. **Returns a plan, makes no data writes.**
- `test/billing.test.mjs`: 19 positive/negative Node tests for forged payment markers, brand/App/store/Worker mismatch, ownership hijack, duplicate/conflicting notifications, reordered refund, chargeback, no paid Battery.
- `schema/0001_billing_rebuild.DRAFT.sql` and `test/test_schema.py`: unapplied single-domain D1 proposal; 9 SQLite in-memory tests verify UNIQUE first purchase claim, CAS, rollback and outbox referential integrity.
- `docs/adr/0002-starry-iap-strategy.DRAFT.md`: neutral own-vs-RevenueCat cost/control/event/fallback review, vendor decision **not approved**.

## Reproducible commands
```sh
tsc --project tsconfig.rebuild-billing.json --noEmit
node --experimental-strip-types --test packages/rebuild-billing/test/*.test.mjs
python3 -m unittest discover -s packages/rebuild-billing/test -p test_schema.py -v
```
GitHub standalone no-secrets workflow runs pinned TypeScript 5.8.3, Node 22 and Python SQLite without any deployment.

## Interface / authority boundaries
- AI-1 owns authenticated Starry ID `s_user_id`, active Session, revocation and server-only purchase binding. Fake `verifyCurrentIdentity()` in tests is **not** live authentication.
- AI-4 owns Workers, OpenAPI/SDK, Apple JWS validation, App Store Server Notifications V2, Google authenticated RTDN and Google Play Developer API re-query, EAS native sandbox, platform-specific package registry. Fake `verifySandboxEvidence()` in tests **cannot verify a purchase**.
- AI-2 is sole logical Billing writer: `owner+event+entitlement CAS+outbox` in **one transactional D1 write domain**. The physical DB count is undecided, no cross-D1 atomicity assumed. Server-generated `b_` + SHA-256 idempotency key; same key/other digest fail closed, never client-supplied dedupe, raw tokens or receipt.
- AI-3 owns audit retention, outbox consumption/retry, dead-letter and recovery; Billing event shape is **candidate**, not an independent canonical P05 schema (AI-0 owns shared schema).
- Store `storeEnvironment=sandbox` and Worker `environment=development|staging` are independent; Production disabled; app-specific entitlements only until cross-app policy is decided. Starry Battery remains free and cannot be bought.
- Pending: real Apple/Google cryptographic verification, provider account tokens, actual D1 concurrent tests, official SKU/grace/refund policy, Auth/OIDC integration, Webhook/reconciliation, EAS native CI, vendor choice and AI-0 Gate.

ADMIN-PREP: P01 scope candidate, P02 API pending, P03/P04 Auth/admin dependency, P05/P06 outbox/audit mapping pending, P07/P08 monitoring/cost pending, P09 SHA and isolated CI, P10 versioned config pending. No H-Global PAYUNi or second-wave management console.
