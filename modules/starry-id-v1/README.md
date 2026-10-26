# Starry ID REBUILD | AI-1 v1.0.0-draft
**NOT DEPLOYED / NOT LIVE OIDC**. New build from PR #25 SSOT seed; branch independent of historical #22.
This folder is owned by AI-1, includes pure trust and member profile safety policy, candidate OpenAPI and SQLite/D1 logical schema only.

Source: [AI-0 Rebuild Gate 0 PR #25](https://github.com/starry-phd/id/pull/25) fixed `f9c02e2350fc1cf0311574ac05c3536d9b2900f5`; approved SSOT ID-S-001/002, AUTH-001, OPS-001, DATA-001, SYNC-001. `coverage=seed_only` and unresolved per-field visibility/admin policy remain blockers.

Tests from repo root:
```sh
npm exec --yes --package=typescript@5.8.3 -- tsc -p modules/starry-id-v1/tsconfig.json --noEmit
node --experimental-strip-types --test modules/starry-id-v1/test/*.test.mjs
python3 -m unittest discover -s modules/starry-id-v1/test -p test_schema.py -v
```
Files: `src/index.ts` trusted principal with injected non-live verifier; status/session/auth_version; exact admin grant + persisted Passkey/TOTP step-up; CAS minimal profile, explicit opt-in public alias; verified confirmed deletion plan. `schema/001_starry_identity.DRAFT.sql` SQLite in-memory logical owner tables, **never execute on real D1**. `openapi.DRAFT.yaml` candidate-only HTTP API, all responses 501 until AI-4 implements. `ADR-REBUILD-001.md` owners, access matrix, break-glass, risks.
H-Global separate identity and D1 NEVER implemented. Cross-brand DISABLED. No live Apple/Google, Worker routes, Secrets, real data, payments, deployment, production or main merge.
