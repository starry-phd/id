# AI-3 | Starry Battery / Trust & Safety | Gate 1 draft

**Status: DESIGN + unit-tested pure contracts; no deployed API, real D1, queue/worker or Production.** Refs: #4, #1, #13, AI-0 unmerged PR #19, AI-4 unmerged PR #20.

## Decisions and blocked decisions

| Domain | Approved safe baseline | Not approved / not implemented |
| --- | --- | --- |
| Battery | Permanently free; Starry-only; policy status read candidate | Wallet/balance/grants/credits, AI-task reserve/debit/release, expiry/FEFO/overdraft, purchase, funding, archive or expiration reminders |
| Notification | Auth-scoped recipient and preference check, permitted delivery channel | Production Email/OS push, exact security-exception channels, templates, consent storage and retention policy |
| Appeals | Anonymous appeals, case number, opaque lookup token hash, anti-abuse as design candidates | Live public form/API, attachment uploads, database and administrator workflow |
| Privacy | Redacted consent/audit metadata, fail-closed access | Live consent withdrawal, legal retention/export/deletion (AI-1 owns member data) |
| Audit / recovery | Starry P05/P06 metadata, proposed append-only schema and recovery playbook | Real Auth permission checker, write API, D1 restore, production incident actions |

## Deliverables and responsibility

- src/index.ts: free-only Battery policy; P05 event-envelope parity candidate for #19; P06 audit metadata validation; scoped read guard; consent-dependent notification gate; bounded retry and deterministic dedupe namespace. It is NOT a substitute for AI-1 Auth or AI-0 shared contract. After #19 Gate, align/import the canonical common event schema.
- schema/001_audit_design.sql: SQLite/D1 **design only**. AI-3 audit service owns audit writes. Atomic uniqueness of delivery idempotency must be enforced in domain-owned D1 transactions; Cloudflare Queue does not provide transactional exactly-once semantics.
- test/contracts.test.mjs and .github/workflows/ai3-contracts.yml: Node 22 dependency-free local/CI tests, SQLite in-memory schema smoke; no secret or deployment permission.
- AI-1 #2: provide verified Starry admin/member principal, claims, session-revocation, RBAC/ABAC, step-up and notification consent. The standalone mock adminVerified boolean here is NOT a real permission verifier.
- AI-4 #5: Workers endpoint/Queue integration, OpenAPI/SDK parity and liveness/alert telemetry. No public AI-3 API paths until shared PR #19, AI-4 #20 and AI-0 Gate 1 resolve interfaces.
- AI-0 #1: approve app IDs, schema version, legal retention, event types, Battery business meaning, scoped notifications and appeal design, restore approval roles.

## Event delivery and incident policy (proposal, not active)

- P05: event_id, event_type, schema_version, brand_id, app_id, environment, occurred_at, correlation_id, resource_type/id, result, optional idempotency_key; mandatory key for retry. No PII, token, secret, full user fields, before/after values or unreviewed free-form payloads.
- P06: opaque actor_id/kind, permission, action and optional approval_ref. Audit read requires AI-1 live authorization plus Starry/app/environment matching, including audit of sensitive reads. Domain owner performs any real write.
- Retry proposal: only transient network/timeout or 408/425/429/500/502/503/504; five total attempts, exponential suggested 1/2/4/8s base, then dead-letter. Non-transient 400/401/403/409, bad payloads and wrong scope reject without replay. Production must honor safe Retry-After and jitter based on AI-4 queue limits.
- Atomic delivery claim must precede side effects in a domain-owned transactional store. DLQ replay requires verified scoped actor, approval, recorded reason and a new redacted audit; no replay of authorization denials.
- Recovery: isolate incident, preserve correlation/redacted evidence, prefer precise safe correction over full restoration, require verified Starry approver and step-up, rehearse only in isolated environment, verify consistency and record outcome. Never touch production D1 here.
- P07 errors, queue backlog, dead-letter and restored-state alerts belong with AI-4; actual telemetry is UNKNOWN until a service is running. P10 config version/rollback/actor audit is reserved, not a live flag platform.

## ADMIN-PREP P01-P10

P01: trust-bound Starry app/env only. P02: OpenAPI integration pending AI-4. P03: admin API design-only. P04: live administrator identity belongs AI-1. P05: envelope and idempotency tests. P06: audit, SQL and access-negative tests. P07: retry/incident design, no live alerts. P08: AI-4 cost tags, no figures. P09: PR/SHA/CI evidence only. P10: domain-owned server settings pending Gate. No second-wave UI.

## Remaining acceptance

- Gate 1: approve Auth claims, events/schema version, Battery operations, notification preferences, retention/children privacy, anonymous appeal workflows.
- Gate 2: integration negative tests, append-only integrity, parallel atomic D1 idempotency, out-of-order event and failure injection, 429/Retry-After, authorized DLQ replay, redaction, isolated D1 recovery drill, real CI test/typecheck with AI-4 scaffold.


## Gate 1 -> Gate 2 second round

AI-0 PR #19 (f1ee4509) uniquely owns shared P01/P05; the AI-3 local P05 candidate now matches RFC3339 UTC/offset semantics and checks parity against the exact pinned AI-0 TS source in CI. AI-4 will replace the temporary in-domain validation with the canonical import at multi-PR integration; this change does not create a second shared package.

AI-1 PR #22 must supply real cryptographically verified Starry principal, persisted scoped session/member/grant, revocation/step-up and notification-consent authority through a **server-injected** gateway. There is no exported client-side adminVerified boolean. These mocks are not real authorization proof. Server must derive scope, recipient and consent; never accept them from request fields.

AI-2 PR #23 alone owns and writes provider-verified Billing transactions/entitlements/outbox. AI-3 reads that trusted server-only outbox and exclusively appends redacted audit/inbox; invalid/refund-unverified/non-sandbox/payment-for-Battery events quarantine, duplicated events ignore, older events are marked audit-only, never overwrite entitlements. Store environment (sandbox) and service environment (development/staging/production) are independent. DB uniqueness must be committed atomically in AI-3-owned D1 by its single write owner; simulation does not establish real concurrency safety.

Strict TS typecheck, Node contracts/parity/negative cases and isolated SQLite uniqueness tests are in dedicated CI. Still blocked: actual AI-1/Auth and AI-2 outbox wiring, AI-4 canonical import/Worker/workspace integration, official event names and schema versions, retention/legal holds and privacy deletion, recovery approval, refund reviews, actual D1/Queue/production. All PRs remain Draft; no merge or deployment.

Cross-PR CI tests now pin actual AI-1 #22 guards and AI-2 #23 sandbox reducer by exact commit SHA, verifying suspended/deleted/revoked/stale/cross-scope admin+recipient access and duplicate/stale/unauthorized Billing refunds. These direct policy tests do not imply the unmerged files are installed in the actual Worker or prove live signature/consent verification.
