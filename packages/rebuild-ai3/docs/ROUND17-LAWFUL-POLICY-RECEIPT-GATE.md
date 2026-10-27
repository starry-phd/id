# AI-3 R17 | Lawful-purpose and policy-pinned durable Battery receipt (OFFLINE DRAFT)

Source: AI-3 R16 Draft PR #115 fixed `6d059b76e95d556083679ede5558561275346dfc`; AI-0 R15 four-owner verified integration PR #112 `e9b4a9e244342bfc2725b1daafca21dbb35ff8ad`. AI-0 R16 full-owner integration has **not** been accepted as a new source baseline. This is a stacked, independent AI-3 follow-up PR. Git Tree batch, no shared owner/migration changes.

## Executable fix (no new writer)
- The R16 duplicate branch previously accepted a persisted R14 local Battery receipt after Auth revalidation even when current Battery policy was rotated or withdrawn. An unchanged old receipt is **not** a lawful processing grant.
- Before any protected Auth or Battery source read, require current positive integer approved policy version, after the existing lawful-purpose check.
- For a replay, demand `receipt.policy_version === policyAtStart`. Before returning `already_applied_offline`, re-check *current* lawful purpose and policy version after Auth/publisher and double-receipt stability reads. No Battery write on duplicate.
- For first commit or ambiguous reply, demand the persisted local receipt matches the initial policy, then check legal approval and same current policy again **after** the stable receipt and current Auth/publisher verification, before returning local success.
- If policy is absent, stale, changed, throws, or authorization is revoked, fail closed. A local commit may already have happened; **never** claim it was rolled back. Existing `may_ack_queue=false`, `may_regrant=false`, `may_restore=false`, `live=false` remain unconditional.
- Six real Node negative tests cover missing policy before protected source read, stale receipt version, legal/policy revocation on replay with zero mutations, and post-commit legal/policy change with no Queue ACK.

## Non-guarantees and owner handoff
This detects observed policy/consent drift, **not** actual legal approval, global time-of-check/time-of-use atomicity, immutable independent PITR anti-rollback witness, Cloudflare D1 binding, canonical P05 publisher, durable Saga ACK, Task/Billing Store revocation, or actual deletion authorization. AI-0 (#1/#87) must decide canonical publisher, legal Q104/Q119 retention, cross-D1 topology and official policies before any live integration. AI-1 owns authoritative Auth/deletion; AI-4 owns transport/Queue; AI-2 owns Billing; AI-3 owns only Starry Battery.
No new SQL DRAFT/migration, workflow, paid API, production, staging deployment, H-Global, user data, Cloudflare, Store or Secrets. G00–G10 remain 11/11 BLOCKED; `PUBLISHABLE=false`.
