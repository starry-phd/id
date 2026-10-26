# AI-4 Starry ID first-wave engineering foundation

Status: **Draft implementation only**; no Cloudflare deployment, EAS build, stores, member records, or production changes. Owner: AI-4 / Issue #5. Base: main. PR #19 shared types are a separate unmerged AI-0 proposal.

## Layout
- `apps/mobile/`: Expo 54 / Expo Router 6 / React Native Web, development-only navigation.
- `apps/api/`: TypeScript Cloudflare Worker, immutable Starry branding, liveness-only `GET /v1/health` (no D1/R2/Queues/secrets and **not readiness**).
- `apps/api/openapi.yaml`: draft OpenAPI 3.1 document only for the implemented route.
- Root scripts: `npm run typecheck`, `npm run lint`, `npm test`. Root lockfile must exist before CI app-tests can run.

## Gate / dependencies
- P01: fixed Starry-only app/environment, no arbitrary client-side brand selection; registry details remain AI-0 Gate.
- P02: minimal OpenAPI 3.1 liveness; Auth/Admin/SDK endpoint descriptions not fabricated.
- P03/P04: no admin routes, admin authorizations remain owned by AI-1 and domain owners.
- P05/P06: defer to PR #19 and AI-3 audit semantics; do not duplicate event schemas.
- P07: **liveness only**; P95/error/queue monitoring needs deployment and instrumentation.
- P08: cost attribution future metadata; no invented usage/currency or provider bills.
- P09: GitHub PR/CI are evidence; no EAS/Cloudflare builds or releases claimed.
- P10: feature flags disabled until backend authorization and audit contracts exist.
- Cross-brand member syncing is **not wired**; no H-Global calls, credentials or storage.

## Local verification
```sh
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npm test
npm run web:dev
npm run api:dev
```
Web and native require actual device/emulator inspection; no four-platform verification is claimed by automated tests. Do not run deploy commands without a separate release gate. AI-0 should review config and compatibility before merge.
