# AI-3 REBUILD Phase 0 — Trust / Audit / Privacy / Free Battery

**Status: Draft contracts and isolated test-only SQL. Not Gate 0/1 approved, not merged, not deployed.**

Source: [New architecture PR #25](https://github.com/starry-phd/id/pull/25) at f9c02e2350fc1cf0311574ac05c3536d9b2900f5. Its 25 requirement entries are seed_only; cannot claim complete review of original 108/130 functions. Existing Draft PRs #19–#24 are historical candidates, not automatically valid for the rebuild.

## Domain ownership and safe boundary

- AI-3 is the only writer of the redacted audit and inbox logical domain; AI-1 owns Starry ID, sessions, revocation, member erasure and authorizations; AI-2 owns Billing/entitlements; AI-4 owns Worker/API/Queue routing and CI integration; AI-0 owns SSOT/Gates and data placement decisions. H-Global remains outside this repository.
- AUDIT-001: typed, versioned, strictly allowlisted, metadata-only event and audit schema. Starry brand, app and runtime environment must match **trusted server scope**; RFC3339 timestamp must be a real date with timezone. Actor/resource refs must be pseudonymous; do not store raw user IDs, email, phone, secrets, free-form payload or before/after profile values.
- TrustedAuthPort is only an **adapter interface**: the actual AI-1 Worker integration must originate it from verified cryptographic sessions, fresh persisted grants, suspension/revocation state and current notification consent. Never construct it using a client request/adminVerified/forged recipient. No actual OAuth or notifications run here.
- Failure plans: at most five attempts; transient failures only, then dead-letter; access/auth errors reject without replay. Replay remains review_only even with an approved server principal, never sends a Queue job. Stale session revocations cannot restore access. SQLite-in-memory demonstrates unique keys and atomic insert/append within one connection; it does **not** demonstrate D1 multi-worker exactly-once behavior or determine the physical D1 layout.
- Privacy and erasure of member data are AI-1's domain. AI-3 erasureGate does **not** delete records. Audit retention periods, lawful deletion/legal-hold policy, pseudonym key management, anonymized deletion proof and approved purge process remain product/privacy Gate decisions. Append-only trigger is a *draft*, not a blanket denial of statutory deletion rights.
- Appeals, notification templates, security notice exceptions, push/Email transport, rate limits, recovery permission and policy flags need specific approval before any live API. Proposed event kinds and version are **candidates**, not the globally accepted canonical P05; AI-0/AI-4 must settle common event ownership/schema.
- BAT-001: Battery permanently free, Starry-only. BAT-002 weekly quota, wallet, balances, credits, grants, reservation, debit, FEFO, expiry and overdraft remain **unapproved and disabled**. No paid Battery API.

## Reproducible standalone checks

- Strict TypeScript: npm exec --yes --package=typescript@5.8.3 -- tsc -p packages/rebuild-ai3/tsconfig.json --noEmit
- Node 22: node --experimental-strip-types --test packages/rebuild-ai3/test/*.test.mjs
- SQLite memory: python3 -m unittest discover -s packages/rebuild-ai3/test -p 'test_*.py' -v

No live D1/Queue/Cloudflare route, production environment, secrets, H-Global or payments touched. Do not infer all 108/130 historical features have been approved. Link evidence to GitHub #4/#1 and the new Draft PR.

## ADMIN-PREP P01–P10 (draft crosswalk)

P01 scoped brand/app/runtime env (tested); P03/P04 scoped server-auth policy adapter (mock only); P05 versioned event candidate (tested, global shared owner pending AI-0); P06 immutable metadata/inbox SQL candidate (in-memory only); P07 retry/dead-letter proposals; P10 privacy/retention approval Gate. P02, P08, P09 integration and data tags belong to AI-4. No second-wave UI.

## Round 2 | AI-2 #29 → AI-0 P05 → AI-3 Audit (2026-10-26)

- Design-only server adapter `bindBillingAuditBridge` consumes **only an AI-2 committed+provider-verified outbox** through an injected read-only server port. AI-2 owns Payment/entitlements/outbox writes, AI-3 owns its audit inbox; never grant or restore billing rights from audit events. No live adapter/queue.
- The AI-2 #29 `OutboxCandidate` is 11 strictly allowlisted camelCase fields. Its `billing.store_state_observed` is now an **event candidate** in AI-3, not globally approved. `mapAi2OutboxToP05` maps to a safe 12-field snake_case **P05 candidate** only, removing store_environment, transaction string/PII, token and raw provider receipt. Audit IDs and resources are server-generated pseudonymous hashes, timestamp from committed authoritative data, not untrusted request.
- **Single canonical owner**: AI-0 must define the schema version and canonical validator. AI-3 requires `Ai0CanonicalP05Port.validateForScope` to return true; without it no ready event is possible. The mapper is a transitional consumer bridge, **not** a second shared P05 validator, and integration will adopt the actual AI-0 canonical module via AI-4.
- AI-3 tests prove duplicate-key same digest, conflicting digest/event_id quarantine, mismatched brand/App/runtime, non-sandbox store, uncommitted or unverified provider and unknown/PII fields reject; historical events audit-only. Retry/DLQ remain bounded and replay requires independent privileged approval. SQLite in-memory `0002_billing_audit_DRAFT.sql` demonstrates an atomic same-domain claim + audit only; does not simulate or authorize a cross-domain D1 transaction.
- Dedicated CI additionally fetches AI-2 #29 **pinned SHA `c273a99e`** read-only and executes **non-skipped direct runtime tests against its real TypeScript planner** in `integration/`. No new shared package or root-workspace changes.
- **Open Gate issues**: AI-0 global P05 version/event approval, AI-2 atomic outbox state and server produced timestamps/hashes, AI-4 trusted composition/Queue, real OAuth/store verifier, D1 atomic concurrency and crash recovery, privacy/audit retention. Battery quota/wallet and paid operations remain blocked; no merge/deploy.
