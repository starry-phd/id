# Starry ID — first-wave P01/P05 shared contracts

**Status: Draft PR #19 only. No Auth, database, payment, Queue or deployed service.**

- **P01 scope:** `assertStarryResourceScope(trusted, actual)` compares a server-derived Starry brand, App and runtime environment. Plain scope objects only; extra properties, inherited scope, another brand/App/environment or malformed `app_id` fail closed. This is defense in depth, **not** cryptographic identity or authorization.
- **P05 event envelope:** `isStarryEventEnvelope(value)` checks the canonical metadata fields. Unknown fields are rejected. Machine labels allow 1–128 ASCII letters/digits and `._:-`, beginning with a letter/digit. Opaque IDs or event values outside this format require an explicit contract decision rather than silently accepting free-form text.
- **P05 time:** `isRfc3339Timestamp(value)` accepts a real calendar date with explicit UTC `Z` or numeric timezone offset. Dates such as 2026-02-29 or April 31, no timezone, leap seconds, `24:00` and 10+ fraction digits are rejected. Timestamp precision / timezone representation should be normalized by the domain owner.
- **Combined Gate:** `assertStarryEventForScope(trusted, value)` validates the event and checks it against a **trusted server-derived** Starry App/environment scope. It is not an authentication API.
- **Disabled cross-brand sync:** `CROSS_BRAND_MEMBER_SYNC_ENABLED` is statically `false` and there is no live adapter or external network call.

The guard blocks unknown keys and common unsafe labels; **it cannot detect every personal value or secret hidden inside an allowed string**. Domain owners must apply their specific event allowlists, user consent, privacy and audit rules. The trusted scope must never originate from a client supplied claim alone.

**Coordination:** AI-0 owns this contract and PR #19; AI-1 owns verified Auth/Admin and permission decisions; AI-2 owns Billing sandbox; AI-3 owns actual domain event/audit semantics and data retention; AI-4 owns workspaces, OpenAPI/SDK, Worker adapter, CI integration and the root lockfile. PRs #20–#23 are separate Drafts; they are not merged into #19. Shared DTO parity/integration must be verified before Gate 2.

## Verification

```sh
tsc --noEmit --project tsconfig.contracts.json
node --experimental-strip-types --test packages/contracts/test/*.test.mjs
```

GitHub `.github/workflows/starry-contracts.yml` runs strict TypeScript and Node tests. This CI is not full Expo/Workers App testing. Prior standalone success does not prove cross-PR integration; check the exact latest SHA and workflow run before citing results.

- `example-starry-app` is a **test fixture**, not a formally registered production `app_id`.
- App runtime `environment` (development/staging/production) is separate from Apple/Google `store_environment` (sandbox/production); no Store IAP code exists in this package.
- No Production, staging deployment, external Cloudflare updates, real D1, payment or H-Global work is authorized.

Sources: AGENTS.md; approved ADMIN-PREP #13; AI-0 #1; canonical repository `starry-phd/id`; the retired `starryphp` account is excluded.
