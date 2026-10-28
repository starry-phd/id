# AI-0 Cloudflare Workers Builds read-only RCA — 2026-10-28

## Verified exact build / SHA
Previous AI-0 R005 four-owner integrated draft [PR #214](https://github.com/starry-phd/id/pull/214), SHA `55b8e31a64b62828dbdeb075f38150f02983fa86`, external Workers Builds [GitHub check #122957469384](https://github.com/starry-phd/id/runs/122957469384) **completed/failure**, Cloudflare Build ID `f5e2a6ec-d4db-49f3-8126-ec2225b6e8e7`.

**Source:** Cloudflare authenticated Workers Builds API read-only GET `/accounts/{account_id}/builds/builds/{build_uuid}` and GET `.../{build_uuid}/logs`, linked Starry account, untruncated log. No configuration mutation or deployment API request.

## Exact actual failure, proven from original Cloudflare log
- Worker Build Trigger **branch_includes AI-0 R005 draft branch**, GitHub push event, root directory `/`, build command empty, deploy command **`npx wrangler preview`**.
- Dependencies installed successfully: npm clean-install, **845 packages**; Wrangler runtime printed v4.152.0.
- Deploy-stage error, exact original log: **`Your Wrangler configuration is missing a `previews` block to run this command.`**. Exit: `Failed: error occurred while running deploy command`.
- Existing repo contains **`apps/api/wrangler.toml`**, and current top-level root has no `wrangler.toml/json/jsonc` according to immutable tree inventory at SHA. Root package scripts explicitly provide `--config apps/api/wrangler.toml --env staging` for **dry-run**; Cloudflare Build trigger uses root `npx wrangler preview` without `--config`. The config's contents do not contain a `previews` block. Consequently, **two things need re-evaluation** before a fix: which config path preview command should actually read, and what isolated preview bindings/vars are permitted. Simply adding an empty previews block in the subdirectory may not fix a root-invoked command if it does not read that config.
- Official Cloudflare Workers Preview guidance: https://developers.cloudflare.com/workers/previews/configuration/ — an empty `previews = {}` (TOML) or `"previews": {}` (JSONC) may satisfy syntax, **but preview does not inherit production top-level settings**, and some service bindings to production can leak if misconfigured. Need a separate test-only binding/security review.
- External build `failure` does not prove production deployment or successful preview. AI-0 made only GET calls to logs and config read; this file does not authorize re-running Preview or changing a trigger. **Never claim Cloudflare success just because GitHub Actions 3/3 passed.**

## Proposed options; NOT executed
A. **Default safe choice for current Draft-only/offline Gate:** ask Owner to authorize stopping automatic Cloudflare Workers Builds for AI-0 and owner Draft branches (make read-only GitHub Actions the primary check), or change branch filtering strictly via approved settings. Warning: changing trigger can affect existing workflows; roll back filter if unexpected.
B. If Preview is later explicitly authorized, write an isolated planned config diff and read-only review: `npx wrangler preview --config apps/api/wrangler.toml`, appropriate `previews` block, all preview bindings pointed to *test* resources or omitted, no D1/Queue/prod secrets, verified root/package naming, costs and rollback; **this is not an approval to edit, deploy, create preview resources or run this command**.
C. Leave trigger unchanged and document external build failure as an explicit independent blocker until Owner grants a safe change.

**Status:** ROOT_CAUSE_CONFIRMED_FOR_THIS_BUILD / CHANGE_NOT_AUTHORIZED / GATE3_BLOCKED. Official Store/RevenueCat/Ads OFF state unaffected; private consumer Monorepo Q5 still deferred.
