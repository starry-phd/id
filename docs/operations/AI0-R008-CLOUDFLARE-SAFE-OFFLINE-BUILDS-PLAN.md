# AI-0 R008｜Cloudflare id-starry Build governance after Owner-authorized Preview disable (offline only)

**Status: HISTORICAL verified account snapshot + offline policy/test only. This is NOT a live configuration monitor, a Preview deployment, or a release approval.**
**Baseline:** R007 four-Owner integration Draft [PR #226](https://github.com/starry-phd/id/pull/226), SHA `766ee89cc9991d8c17c6f610e6bdbbdb4aa78172`. New R008 AI-0 branch is additive; all four owners' R007 original blobs and tests are preserved by inheritance.

## A. Exact observed and authorized Cloudflare change
- User explicitly approved turning **only** the `id-starry` Worker Git-connected **Preview Builds OFF**, leaving the existing production automatic builds disabled. Connected scope: Starry Cloudflare profile, Worker `id-starry`, GitHub `starry-phd/id`, production branch `main`.
- Cloudflare authenticated GET before: `previews_enabled=true`, `auto_build_enabled=false`.
- Executed one approved Cloudflare API **PATCH `{"previews_enabled":false}`** with HTTP 200; independent authenticated GET after and second later GET both returned `previews_enabled=false`, `auto_build_enabled=false`. Production command stayed `npx wrangler deploy`, root `/`; the API **did not invoke this deploy command**. The previous Worker deployment list had no new deployment following this change. No other Worker settings, H-Global account, Worker script, bindings, secrets, repositories, or main branch were modified.
- Static commit evidence and approved scope are in `docs/operations/ai0-r008-cloudflare-builds-disabled-audit.v1.json`. A checked-in JSON record is historical; changes made subsequently in the Cloudflare dashboard cannot be seen by GitHub offline CI. **Re-run authenticated, read-only GET before any future assertion of current live state.**

## B. Confirmed R007 failed Cloudflare Build root cause (not a GitHub test failure)
- Exact Cloudflare Build `a5d6e3a0-4319-4fb5-9db1-45f2a7d3fe7c` for R007 `766ee89cc9991d8c17c6f610e6bdbbdb4aa78172` recorded `FAIL`; raw Cloudflare log was retrieved by authenticated read-only GET. npm dependencies installed; Cloudflare then ran **`npx wrangler preview` from root `/`** and Wrangler failed with **`Your Wrangler configuration is missing a previews block to run this command.`**
- The monorepo has no root Wrangler file; its safe *offline* Worker config is `apps/api/wrangler.toml`, which does not contain `[previews]`, real D1/Queue bindings, or production env. The repo's `npm run api:check` explicitly selects `--config apps/api/wrangler.toml --env staging --dry-run` and passed within GitHub CI. **Do not claim adding `[previews]` to the child TOML alone fixes a root-invoked command.**
- GitHub exact-R007-SHA offline CI independently passed 1,699 Node and 379 memory SQLite tests; Cloudflare external BUILD remained failed, and historical failed check statuses do not become green when Preview automatic Builds are disabled.

## C. Proposed stage-2 isolated Preview design — **not executed**
1. Obtain **separate owner approval** before any Preview trigger reenable, creation, public URL, new resources, cost, or deploy. Review whether GitHub branch protection requires an external Cloudflare status; **never substitute local tests as live authentication or proof**.
2. Verify Wrangler source/CLI and root directory together, pin a compatible local Wrangler release for reproducibility, and write an explicit reviewed `[previews]` block / isolated Preview config. The intended preview command must point to the actual config, not assume a root Wrangler file.
3. Restrict preview scope to the single Starry test Worker; **no production** routing/deploy, **no D1** production binding, **no Queue** consumer/ack, **no Store**/RevenueCat live calls, **no Ads**, no H-Global, no real member PII or secrets. Review even Service binding reachability to production Workers, test-only identity, Cloudflare Access, preview URL exposure, and quotas/billing before allowing any deploy.
4. Optionally review branch/path filters and build caching **only after** the desired test scope and future build trigger policy are documented. The existing `auto_build_enabled=false` production switch must remain off.
5. **rollback**: if and only if a later separately approved Preview is unsafe, disable its Preview builds, remove only independently authorized test resources, preserve audit logs and restore the last reviewed config. Do not silently enable production or roll back the current owner-approved disabled flag.

Official refs:
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
- https://developers.cloudflare.com/workers/previews/configuration/
- https://developers.cloudflare.com/workers/previews/resources/

## D. Release and owner coordination
- Gate1 PARTIAL/BLOCKED; Gate2 R007 same-SHA OFFLINE PASS only; Gate3 G00–G10 BLOCKED 11/11. `P05/PUBLISHABLE=false`, `release_authorization.granted=false`; Starry Battery permanently free, Ads OFF; Expo54 unchanged.
- Do **not** merge main, deploy Preview/Staging/Production, touch real D1/Queue/Store/RevenueCat/EAS or enable any AdMob SDK or new paid services in this change.
- AI-4 owns actual Worker config and Preview wiring; AI-0 owns this **offline audit/test**. No AI-4 writer code changed. Future change to `apps/api/wrangler.toml` requires the correct AI-4 owner handoff plus separate Cloudflare safety/approval.
- This PR has no automatic production effects. An offline CI PASS does **not** authorize manual or automatic deploy.
