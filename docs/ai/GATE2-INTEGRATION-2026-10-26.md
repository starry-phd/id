# AI-4｜Gate 2 Single Integration Candidate｜2026-10-26

> **DRAFT FOR AI-0 GATE 2 ONLY. Not approved or deployed.** This is not an EAS build, OAuth, store verification, real D1 migration, staging or production deployment.

## Exact pinned source snapshots

| Source owner | Draft PR | Fixed commit included |
| --- | --- | --- |
| AI-0 canonical P01/P05 | #19 | `741fb8572484e2390b3715854fcf27420592c80a` |
| AI-4 Expo Router/Workers/SDK/lockfile | #20 | `b381f9a23cf45f50c43a0dd211bcd67e1d7c642f` |
| AI-3 free Battery/Audit/Notifications | #21 | `3b83d8c27fc2d3fd3835b12fbf955689195e746b` |
| AI-1 Auth policy and opaque principal | #22 | `8932398f6050c15f1a5569c2cd7d7e4c7fa76867` |
| AI-2 Billing Sandbox contracts and ports | #23 | `a60fb179bca3d0422d56b69a4ac9a0f81e0180b1` |

**Base:** main `8be31efb3dfba66755f297b315593e33cdacfe39`. Independent integration branch `ai4/gate2-integration-20261026`, Draft PR #24. Files from each fixed SHA were copied unchanged into this separate candidate; original Draft PRs and `main` were not merged or updated.

## Integrated safety boundary

- Only live-implemented API specification: `GET /v1/health` liveness. The auth, billing, admin and audit draft OpenAPI documents are **design-only**; no new routes, OAuth providers, receipts, payments, Cloudflare Queue or D1 are wired.
- AI-0 `packages/contracts/src/index.ts` owns P01 trusted Starry scope and P05 RFC3339 event canonical validator. Gate 2 cross-owner test imports this exact module and rejects cross-brand/unknown keys, invalid timezone dates, fake claims.
- AI-1 `modules/starry-auth/src/principal.ts` owns opaque `TrustedStarryPrincipal` provenance and backend-supplied session, member status, admin grants, recent step-up. Integration test mints a principal **only through test-mocked upstream verifier**, uses the module's real identity/refund/audit adapters, rejects forged JSON and revoked/suspended claims.
- AI-2 `packages/billing-contracts/src/trusted-adapter.ts` owns store sandbox projection and trusted ports; actual provider crypto and transaction ledger are **not** connected. Tests distinguish Worker `environment: development|staging|production` from `store_environment: sandbox|production`. Gate 2 only permits runtime development/staging with store sandbox, and never uses client `verifiedBy` as authority.
- AI-3 `packages/ai3/src/index.ts` owns audit and free Battery, and requires server-supplied trust gateway and verified billing outbox. Integration parity checks safe canonical event envelope, replay, stale event, cross-brand and refund-not-verified quarantine. Battery grant/debit/FEFO/wallet remain **disabled**.
- AI-4 `packages/integration/**`, root config and `.github/workflows/ai4-gate2-integration.yml` own only glue, tests, and CI. This code is **unrouted and not an authenticating implementation**; using it as a production adapter would require vetted backend-verifier and transactional D1/queue implementations, official Gates and deployment authorization.

## Reproduction (Node 22)

```sh
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npm test
npm run gate2:sqlite
npm run api:check
```

CI runs all module unit tests, cross-owner tests, SQLite in-memory smoke (AI-1 CAS + AI-3 audit/dedupe) and `wrangler deploy --dry-run` with read-only repository token. There is **no runtime deployment** in this workflow. See the latest run for current PASS/FAIL; standalone PR CI success is not equivalent to Gate2 cross-PR success.

## Gate 2 risk / block matrix

| Risk or dependency | Evidence / disposition | Owner / before Gate approval |
| --- | --- | --- |
| Actual social login/JWKS/PKCE/verified Session | Contract and mocked provenance only; no live verifier | AI-1/AI-4, deferred |
| Server identity + refunds | Trusted mock ports and negative tests, no real Apple/Google verification | AI-1/AI-2 |
| Transaction and audit uniqueness/atomicity | In-memory SQLite and pure adapter only; no real D1 transaction | AI-2/AI-3 |
| P05 event identifier/token safety | Canonical validation; domain payload schema/privacy still requires approval | AI-0/AI-3 |
| Temporary lint exception for AI-2 upstream | `trusted-adapter.ts` unused destructured `principal`; filename-and-name-specific exception in integration ESLint; [Issue #3 handoff](https://github.com/starry-phd/id/issues/3#issuecomment-6406185935) | **AI-2 must fix on #23 and AI-4 must repin/remove exception before Gate2 acceptance** |
| Cloudflare Preview Build FAIL | **READ-ONLY verified:** existing Workers Build ran `npx wrangler preview`, failed because Wrangler config lacks `previews` block. This failure is not evidence of a successful deploy, or an integrated GitHub Actions failure. No Cloudflare setting changed. | AI-0 / Cloudflare owner decide preview policy separately |
| Expo EAS iOS/Android physical or store testing | Not executed; Expo Go cannot prove native IAP | AI-4 with owner authorization later |
| Actual staging/production/Secrets | Forbidden in this round; intentionally not run | owner/AI-0 Gate |
| Formal ADMIN-PREP P01–P10 full API | Only preparatory typed contracts, safe liveness and CI; no 60 endpoints | later Gate decisions |

## AI-0 acceptance

Review latest PR #24 HEAD and genuine GitHub integration CI (typecheck/lint/full Node tests/in-memory SQLite/Wrangler dry-run). Enforce same pinned snapshots and deny all backend/client fake authority. **Keep every PR Draft; do not merge or deploy without explicit later authorization and domain owner/Gate reviews.**
