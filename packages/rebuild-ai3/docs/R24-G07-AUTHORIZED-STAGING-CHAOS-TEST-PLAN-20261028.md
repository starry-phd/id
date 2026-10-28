# AI-3 R24｜G07 D1／Queues／DLQ／PITR「正式受控 Staging 驗收」可執行安全計畫

**Scope:** AI-3 Battery／P05-P06 audit/recovery; [SBASE #156](https://github.com/starry-phd/id/issues/156), [AI-0 #1](https://github.com/starry-phd/id/issues/1), [AI-3 #4](https://github.com/starry-phd/id/issues/4). This is a **dry-run plan generator, not a real test**, approval, signed-source publisher or migration. Never operate or publish production with these samples.

## Latest already completed — do not redo

- AI-0 same-checkout [R23 Draft #171](https://github.com/starry-phd/id/pull/171), fixed source HEAD `2841011b9a32680d889c53062b659b15b1ac63e9`, includes all prior SBASE #164/#165, four R23 Owners and portfolio #170 unchanged; 3/3 GitHub Actions success. Its parent is only an **offline** CI integration. Remains open/Draft.
- AI-3 #168 R23 `r23-g07-readiness-preflight.mjs` already inspects **real checked-in** staging `wrangler.toml` and official release manifest: no declared staging D1, Queue producer/consumer DLQ, G07 blocked. It does not prove physical Cloudflare resources absent. This R24 adds **an acceptance procedure for the real future trial** rather than another copy of the static scan or mock Wallet.
- AI-0 #87 physical A/B **undecided**. A = approved single transaction authority for claim+Wallet/outbox. B = distinct D1 with persistent outbox/Saga and explicit no-spend pending state. C = simple read-then-write is NOT a production alternative. Neither A nor B may be selected by this AI.
- Existing Cloudflare #164 Preview Build FAILED; AI-0 chooses **hold existing trigger unchanged**, no push monitored #164 branch. AI-4 handles separate Preview RCA. G00–G10 11/11 blocked; release authorization false.

## New concrete output and safe commands

`tools/r24-g07-staging-trial-plan.mjs` generates a machine-readable, no-PII 16-case controlled staging matrix. Cases 12 shared + 1 A + 3 B; selecting A/B via local parameter only **filters a proposed checklist**, does not count as an approved architecture. Node22 standard library and existing R23 static preflight are the only dependencies.

```sh
node packages/rebuild-ai3/tools/r24-g07-staging-trial-plan.mjs --plan
node packages/rebuild-ai3/tools/r24-g07-staging-trial-plan.mjs --assert-blocked
node packages/rebuild-ai3/tools/r24-g07-staging-trial-plan.mjs --execute
# --execute MUST exit 2, never contacts D1/Queue/Cloudflare
node --test packages/rebuild-ai3/test/r24-g07-staging-trial-plan.test.mjs
```

This tool performs **NO network call, write, time-based retry, migration, Queue ACK, KMS, real PITR, D1 transaction or platform deployment**. Every emitted case says `NOT_EXECUTED`. All rights `may_execute/may_ack_queue/may_write_d1/may_restore/may_approve_release/may_sell_battery/verified_live=false`. A mocked or locally edited manifest cannot transform the static plan into an external trust root. There is no real signed P05 issuer.

## Controlled live test protocol — proposed, NOT authorized

**Before any account access, Worker/DB provisioning or paid action, AI-0 must collect:**
1. Written and independently checked human approval for **specific Starry-only separate staging account/project, branch, Service and named operators**; no H-Global, production Worker, public Preview or personal/real member records. No new account/DB/Queue before permission.
2. #87 A or B **formal owner decision** and data writer table. A: claim UNIQUE + Wallet + Outbox truly same D1 transaction. B: two real D1 stores with durable status/outbox, compensation and pending-unspendable state, no fantasy cross-D1 ACID.
3. AI-4 independent inventory of staging D1, producer, consumer/DLQ, Workers isolation, secrets, Cloudflare plan cost estimates, **explicit written maximum budget** and rollback/deletion strategy; obtain sufficient granted permissions, but never copy tokens into this public repository.
4. AI-1 authorized synthetic registration and revocation test issuer; AI-0/AI-4 unique official **signed P05** version; Q104/Q119 documented lawful purpose, minimum retention and HMAC/KMS key management; trusted external **nonrollback witness** whose lifecycle is independent of D1 PITR. Missing any item = STOP.
5. Pre-test capture: clean synthetic dataset snapshot, versioned schema and release SHA, consumer ACK/retry/DLQ settings, independent time/version correlation and redacted log destinations; confirm no private member identifiers or secrets can flow into GitHub reports.

**Execution once separately authorized by AI-0:** run shared `G07-01..G07-12`, then architecture-specific `G07-A1` *or* `G07-B1..B3`, using **only disposable synthetic members and zero-pay/free Battery**; capture the required separate cloud transaction/queue/witness receipts defined in JSON plan, plus two Worker runs to prove actual dedupe. All event payloads must remain minimal P05 pseudonymous metadata. Inject physical network/Worker ACK interruption and D1 rollback *only* inside permitted isolated staging environment, never production. A Queue ACK only after committed durable state; delayed/deleted member cannot settle; PITR older than external witness must abort restore; DLQ replay needs step-up and audited approval.

**Immediate stop conditions:** any real member data / cross-brand scope, unexpected prod or public Preview binding, costs exceeding approved cap, unsigned P05, missing valid auth source, duplicate gift, Queue ACK before committed D1, stale PITR revision, legal-hold violation, failed cleanup. **STOP = terminate synthetic test and preserve redacted error evidence; never restore/compensate automatically without the approved policy**.

**Independent evidence expected from platform:** (a) externally retrieved Worker version/resource mapping and permission isolation; (b) D1 committed transaction revision and CAS uniqueness; (c) actual Queue delivery/ACK-before/after evidence and DLQ records; (d) provider PITR snapshot/restoration metadata; (e) independent KMS/witness signed monotonic floor; (f) legal retention policy and owner approval; (g) cost/rollback cleanup signoff. A local JSON saying `passed` cannot satisfy these items. AI-0 must check links and signatures against distinct source systems; AI-3 does not approve release.

## Ownership and next actions

| Owner | Actual deliverable required before live G07 |
|---|---|
| AI-0 | Official #87 decision, exact consent/cost/scope/recovery approvals and independent evidence review |
| AI-1 | Truly authoritative synthetic Auth/first-claim issuer, revocation and registration uniqueness in approved staging |
| AI-4 | Independent separated Cloudflare staging Worker, D1/Queue producer/consumer/DLQ resource and cost/rollback setup, official P05 source plumbing (no existing id-starry trigger change) |
| AI-3 | Execute this G07 physical replay/ACK-after-commit/DLQ/PITR test suite only after authorization, review redacted evidence, preserve Battery unique writer and P06 retention |

**CI/compatibility/cost/rollback:** New source only under `packages/rebuild-ai3/**`. No dependencies, npm/Expo/Workers config, secrets, migrations, D1, H-Global or paid SDK. Run GitHub CI on final exact SHA. Backout by closing Draft and dropping 3 new AI-3 files. Until real independent trusted Cloudflare+legal+P05 proof, G07, G06, G10, P05/PUBLISHABLE and all G00–G10 remain BLOCKED.
