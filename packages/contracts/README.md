# Starry ID — first-wave P01/P05 TypeScript shared contracts

**Draft PR only — not deployed and not connected to Auth, D1, payments or production.**

This zero-dependency TypeScript package supplies the first shared contracts:
- **P01**: `starry` brand and distinct app/environment scope; reject cross-brand / other-app / staging-to-production scope changes.
- **P05**: versionable typed event envelope matching `docs/contracts/FUTURE-STARRY-ADMIN-API.md`; reject extra fields to avoid accidental secrets or private data in a shared event.
- Cross-brand member synchronization is `false` and has no real adapter. `example-starry-app` is a test fixture, not a newly approved production `app_id`.

Scope checking is a **defense-in-depth contract guard, not authentication or admin authorization**: only pass trusted server-derived scope. AI-1 still owns Auth, scopes, RBAC/ABAC and step-up checks. AI-3 owns event retention and audit semantics. AI-4 owns Expo/Workers scaffold and the package-manager/lockfile.

Locally validated with Node 22 and `tsc --noEmit --project tsconfig.contracts.json` (TypeScript compiler 5.8.3), plus:

```sh
node --experimental-strip-types --test packages/contracts/test/*.test.mjs
```

The new GitHub workflow checks only this contract suite. Existing `Starry CI` app typecheck/lint/tests remain **SKIPPED** until AI-4 builds an actual Expo/Workers app with root package manifest, lockfile and CI scripts. Do not misreport contract tests as whole-app tests.

Sources: approved First Wave ADMIN-PREP, Issue #13; first-wave kickoff Issue #1; canonical repo `starry-phd/id`, never retired `starryphp` GitHub login. No H-Global work.
