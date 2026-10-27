# AI-3 Q116｜D1 PITR + protected independent backup｜isolated recovery Gate

Authority: AI-0 Issue #1 owner-approved Q116=A; latest AI-0 R8 complete offline integration PR #71 (e130bfde68ef0fa40c628a24ec0abade0611d68f), which contains AI-1 Q119 privacy/first-gift, AI-4 task-evidence and AI-3 Q114/Q115. Development workflow follows PR #70 GitHub SOP; all files submitted in one commit.

## Offline implementation

- src/recovery-guard.ts: deterministic **review-only** verifier for a Starry-only isolated-test restore bundle with D1 PITR + independently protected backup, distinct references/digests, exact scoped DTO, **two trusted server attestations**, fresh authoritative fence vector, privacy legal hold, current operator Step-up and durable evidence receipt.
- Seven monotonic high-watermark fence domains: deleted members, revoked sessions, claimed registration gifts (Q119), Battery append-only journal, committed AI tasks, Billing outbox, and audit events. A stale PITR, inconsistent protected backup, deleted identity resurrected, gift claim roll-back, or unknown legal hold is **BLOCKED**. Differences demand gated human reconciliation / replay design, never automatic replay. Even an eligible result is **review_only** and may_restore=false.
- New Node security tests and SQLite :memory: two-connection isolated recovery drill simulate rollback, stale backup, conflicting gifts, deletion/session/tombstone fences, legal holds; no external D1, R2, Worker, Queue, Store, key or payment calls.

## Not yet tested / blockers for actual Q116 operational acceptance

1. Real Cloudflare D1 PITR recovery support & retention by paid/free plan, successful export/snapshot checksum, physical R2 protected independent backups (encrypted key rotation, geographically and account-isolated ACL), cost forecasts. No resources created without owner approval.
2. Real source-of-truth per-domain high watermarks across **independent AI-1/Auth, AI-2/Billing, AI-3/Battery/Audit, AI-4/Task**. A watermark equality check alone is **not a proof of completeness**: final recovery needs per-record reconciliation, signed manifest completeness, replay exclusion, DB integrity, idempotent outbox/dedup, immutable deleted-user/antigift registry, stock/wallet checks and case attachments.
3. Legal/privacy Gate Q115 retention of evidence and Q119 lawful minimal identity fingerprints. Avoid retaining raw OAuth identity; key rotation and erasure rights reviewed by AI-1/privacy. Refuse orphan/older snapshots, unverified H-Global scopes, restored expired sessions, replayed paid entitlements.
4. Authorized isolated rehearsal under a separate future Gate: two-person break-glass where legally required, documented restore point and restore time, backup re-encryption and actual rollback path, app health / audit evidence, Q116 recovery time and data-loss objectives as approved measurements.

**No actual restore service exposed.** LIVE_RECOVERY_ENABLED=false; RESTORE_MUTATION_ALLOWED=false. 11/11 Release Gates G00–G10 still BLOCKED, P05 publishable=false. Do not merge main, deploy Preview/Staging/Production, migrate/write live D1/Queue/R2, operate Secrets/OAuth/Store/EAS, pay for resources or resume H-Global.
