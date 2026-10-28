# AI-3 R23｜G07 真實 D1／Queues／DLQ 讀取型預檢器
**Status:** IMPLEMENTED (static repo inspection only), VERIFIED_LIVE=false; official G07 and G00–G10 11/11 remain BLOCKED.

## Evidence source / base
- AI-0 SBASE [#164](https://github.com/starry-phd/id/pull/164) fixed `11a0c9443ec34c60bcbcf77e1231e4b0f5381e04`: all 18 original Owner/AI-0 Blobs preserved, full GitHub same-checkout CI successful.
- AI-0 R23 live Cloudflare Preview RCA [#165](https://github.com/starry-phd/id/pull/165) fixed `f8a34d843b38c91b5d9d351ee3d54b27696be9d1`: same source plus one AI-0 doc, Cloudflare `npx wrangler preview` FAILED (missing previews block); this is distinct from GitHub CI. This AI-3 branch is stacked on #165, **not** pushing monitored #164 branch.
- AI-3 [Issue #4](https://github.com/starry-phd/id/issues/4), AI-0 [#1](https://github.com/starry-phd/id/issues/1), SBASE coordinator [#156](https://github.com/starry-phd/id/issues/156), unresolved physical cross-D1 ADR [#87](https://github.com/starry-phd/id/pull/87). No external named App or H-Global changes.

## Real new engineering rather than another simulated Wallet
`tools/r23-g07-readiness-preflight.mjs` is an executable, zero-dependency Node22 ESM CLI. It reads only this checkout's **actual** `apps/api/wrangler.toml` and official `docs/release-readiness/release-readiness.v0.json`. It reports whether *staging-scoped* D1, Queue producer and Queue consumer+DLQ declarations exist, and whether G07/release approval are blocked. It ignores comments, unrelated root/prod/development scopes and placeholder UUIDs, never echoes DB identifiers/secrets, **never contacts Cloudflare, reads personal data, changes bindings, runs Wrangler, migrates D1, deploys or executes Queue ACK**.

Current exact checkout: no staging D1, producer or DLQ declaration, G07 blocked, release authority false. Output status remains `blocked`, `verified_live=false`, `may_ack_queue/may_deploy/may_restore/may_write_battery/may_grant_or_sell_battery=false`. Even forged 'passed' local JSON and plausible fake bindings **cannot certify** actual D1, cross-D1 A/B, P05 signature, legal retention or independent anti-PITR witness.

**Run from repo root:**
```bash
node packages/rebuild-ai3/tools/r23-g07-readiness-preflight.mjs --json
node packages/rebuild-ai3/tools/r23-g07-readiness-preflight.mjs --assert-blocked  # exit 0 = correct BLOCKED
node packages/rebuild-ai3/tools/r23-g07-readiness-preflight.mjs --assert-ready    # exit 1 = NOT READY
node --test packages/rebuild-ai3/test/r23-g07-readiness-preflight.test.mjs
```
9 new executable tests inspect **actual** checkout config/manifest and resist forged local approval/root scope/comments/UUIDs/secret exfiltration/CLI false positives. No new SQLite Wallet fixtures; inherited R7/R18/R21 and SBASE #161 remain unchanged.

## Release blocker owners / next actual evidence
| Block | Owner / proof needed |
|---|---|
| No physical staging D1 and Queue+DLQ bindings | AI-4, AI-0 authorization/cost; must verify actual Cloudflare resources independently, not just TOML |
| R23 registration grant claim+Wallet atomicity / #87 A vs B | AI-0 decision; AI-1 Auth, AI-3 Battery, AI-4 Task/outbox real staging crash+retry evidence **after authorization** |
| P05 only signed issuer, legal retention Q104/Q119 / HMAC/KMS | AI-0/AI-4 canonical source and lawful governance, AI-3 redacted audit inbox |
| G07 replay, ACK-after-commit, multi-worker CAS and D1/PITR restore | AI-3 plus AI-4 authorized real staging resources, independent rollback-proof witness, no personal records |
| Starry Battery X/Y wallet, expiry, charging/debit business | DEV-A business approval pending; permanent free and **never a Store SKU** |

**Compatibility/cost/rollback:** no new dependency, npm/EAS/Expo/Worker/Secrets/Paid services; consumes zero Cloudflare resources; only existing GitHub CI capacity. Revert by closing this Draft or removing its three new AI-3 files. Do not rewrite any official release manifest; a static script alone can NEVER authorize Production. G00–G10 11/11 BLOCKED; P05/PUBLISHABLE=false. GitHub Issue is handoff, not automatic invocation of other chats.