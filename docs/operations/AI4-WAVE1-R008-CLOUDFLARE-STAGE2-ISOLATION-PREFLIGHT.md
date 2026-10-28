# AI-4 Wave1 R008｜Cloudflare Stage-2 Preview isolation preflight — OFFLINE ONLY

**Scope / authority:** AI-4 DEV-G/DEV-I, Starry `id-starry` ONLY. Owner manually initiated “開始第八輪”; no authorization to re-enable Cloudflare Preview, modify Wrangler, change Worker trigger or create a test resource. This is a **non-operative** design and executable negative-test set, *not* a deploy runbook or signoff.

**Pinned base**: [AI-0 R008 Draft #227](https://github.com/starry-phd/id/pull/227) exact `aecdee944158b40ffbbd129ddd126136687d7652`; it inherits [R007 four-Owner integrated Draft #226](https://github.com/starry-phd/id/pull/226) `766ee89cc9991d8c17c6f610e6bdbbdb4aa78172`. AI-0 R008 [official Cloudflare audit](https://github.com/starry-phd/id/blob/aecdee944158b40ffbbd129ddd126136687d7652/docs/operations/ai0-r008-cloudflare-builds-disabled-audit.v1.json) remains the source of the **historical snapshot** and release gate. This AI-4 Draft neither changes that record nor presumes it is a live monitor.

## 1. Actual read-only observation and root cause

- On 2026-10-28 UTC, an authenticated **GET**, Starry Cloudflare account, exact Worker ID `id-starry` tag `a375530baef14d4185ff97eb67722fe4`, confirmed `previews_enabled=false` and `auto_build_enabled=false`. Git repository `starry-phd/id`, production branch `main`. **This is point-in-time, not a continuous guarantee.** Other Workers with similar names must not be modified.
- AI-0 Owner previously received explicit, separate permission to disable the **single** Worker's automatic Preview Builds; [AI-0 #227](https://github.com/starry-phd/id/pull/227) records the completed approved change. **This permission does not include re-enabling**, changing staging/production settings, a new public URL, or paying for anything.
- R007 exact-SHA external Cloudflare `npx wrangler preview` failed for absent `previews` stanza at repo root; AI-0 raw Cloudflare logs are independently documented in the R008 audit. Repo has no root Wrangler config, actual configuration path `apps/api/wrangler.toml` and GitHub `npm run api:check` uses `wrangler deploy --dry-run --config apps/api/wrangler.toml --env staging`. **Do not** paste a `previews` block blindly or equate GitHub dry-run with Cloudflare preview success.
- Cloudflare official documentation: https://developers.cloudflare.com/workers/previews/configuration/ ; https://developers.cloudflare.com/workers/previews/resources/ ; https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/ . Preview config must be reviewed independently. **Service bindings can target a production Worker**; an empty `previews` section is insufficient proof of isolation.

## 2. Proposed safety gates before Stage-2 authorization (NO actions performed)

| Gate | Evidence to obtain by separate approved review | Unsafe state / rollback |
| --- | --- | --- |
| G1 — exact source and command | Confirm selected CLI/Wrangler version in `package-lock.json`, root cwd, module resolution and explicit `npx wrangler preview --config apps/api/wrangler.toml` against the current official CLI schema; run no Preview or deployment as part of this Draft | Wrong root path or missing Preview block still fails, never silently fall back to production config |
| G2 — isolated configuration | Add no live bindings in today's code. A *future proposed* `[previews]` / `[previews.vars]` with test-only `STARRY_ENVIRONMENT="preview"` and Starry App ID is only a review fixture; actual Worker currently answers **503** in preview env | `[env.staging]`, production, D1/R2/Queues, Durable Objects, external service, PII, secrets, cron and paid AI bindings forbidden without owner review |
| G3 — public URL and access | Separate decision for Cloudflare Access, authentication on Preview hostnames, CORS/CSP/headers and IP or visibility restrictions; reject default publicly exposed endpoint unless authorized | Revoke the specific Preview and restore `previews_enabled=false`; do not revoke unrelated accounts/resources |
| G4 — costs and resource provenance | Read-only billing, Preview quota and account limits check; prove any future isolated resources are approved, test-only and fully removable | No invented “free” guarantee; no paid build, test resources, EAS or ad purchases |
| G5 — permissions and Gate | AI-0 approves future contract changes; user separately authorizes exact Preview flag, reviewed config diff, any source changes, and eventual live traffic; confirm branch protection and required checks | GitHub offline CI PASS ≠ external Build PASS, Gate3 or authorization to merge main |
| G6 — rollback and observed state | Record pre-change authenticated GET, exact trigger/Worker/tag and SHA; on authorized failure turn Preview off again, preserve audit and keep production automatic builds OFF | Historical fail checks are not retroactively converted to success; don't silently change production trigger |

**Do not infer that the proposed command and TOML example are deployable**: Wrangler syntax and config validation are not established by the source fixture. When legally/technically authorized, re-check docs, CLI version, worker dispatch and full test-only isolation before approving any Build. No live per-member data may enter Preview.

## 3. This Draft's actual executable test surface

- `apps/api/src/wave1-r008-preview-isolation-preflight.ts` adds `starry.ai4.r008.cloudflare-preview-isolation.offline-preflight.v1` — immutable **blocked**-only assessment of hostile/untrusted hypothetical proposal strings. Strict key inspection, no getter invocation, explicit config/command pinning and conservative rejection of resource bindings/routes. A shape-review outcome is still `SEPARATE_OWNER_AUTHORIZATION_REQUIRED`, **never** `may_deploy=true`. This **does not parse TOML, verify Cloudflare state or call external systems**.
- `apps/api/test/wave1-r008-preview-isolation-preflight.test.mjs` new Node negative matrix: base snapshot not live state, Preview & auto-build off history, root/config mismatch, wrong brand/command/path, injected bindings/proxies/prod/service/Queue/D1, proposed test-only vars, **actual Worker preview env GET/POST 503**, no P05/Ads/Queue rights. Existing test glob includes the file via root `npm test` and AI-0 same-SHA offline CI. No changes to `apps/api/src/index.ts`, OpenAPI, `apps/api/wrangler.toml`, `.github/workflows` or production settings.
- This document is planning / rejection evidence; no custom Stage-2 server endpoints, P05 signatures, JWT Auth, KMS, D1, Queue, Store/RevenueCat, Expo EAS or AdMob SDK are introduced.

## 4. Gate/status and transfer

**Gate1 PARTIAL/BLOCKED; Gate2 previous R007 four-Owner and AI-0 R008 independent offline success; R008 AI-4 owner CI must be verified on its own final new HEAD; Gate3 G00–G10 11/11 BLOCKED; `P05/PUBLISHABLE=false`; `release_authorization.granted=false`.** Starry Battery is permanently FREE; Ads OFF, Expo54 unchanged; H-Global paused, external consumer apps out of scope.

**Backout**: close this Draft, remove only these **3 new AI-4 paths**, preserve AI-0 #227 and all R007 owner original blobs; Cloudflare remains as observed OFF unless a later separately authorized human changes it. For AI-0 handoff provide three final Git blob SHAs, final commit, same-head workflow job evidence, and the still-blocked Stage-2 checklist.

*All statements of Cloudflare account state are point-in-time observations; GitHub files and this offline reviewer do not replace a fresh authenticated Cloudflare GET.*
