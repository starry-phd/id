# AI-3｜M2 帳號刪除、資料保留、首贈防重領與 PITR 復原前置安全契約（候選 v0.1）

> **Status: REVIEW ONLY / NOT A LEGAL OR RELEASE APPROVAL**  
> Base main: `6bd75447d707365c90768aa1578de7098802db2d` (M0 #267 + M1 local #266 merged).  
> Normative inputs: [《最新開發技術規範》v1.0 / 流程 v3.0](https://docs.google.com/document/d/1urLja9i9A63jHuz4jQPhPMTgoCtoq-i1TafXPQd3PYU), 2026-10-30 六項決議與 S2-01～13；UP-01/02/03/04/05/10/11/13/15/17/18/21/22/24；[GitHub #220](https://github.com/starry-phd/id/issues/220)。  
> AI-3 domain only. Do not read/write Auth, Billing, production D1/Queue or third-party accounts. No H-Global/Echo operations. Battery is always free and Ads OFF.

## 1. Owner decisions already made — do not re-ask

1. Valid deletion request must lead to removal of **general member personal information and public projections**. Only records objectively necessary under applicable law may be narrowly restricted and retained **after** review of category, legal basis, access, purpose and retention schedule. Suspending an account is not deletion. No legal duration is approved here.
2. Deleted member data must **not reappear after D1 Time Travel / PITR / backup restore**. A tombstone only in the same restorable D1 is insufficient proof.
3. If a member deletes an account then re-registers, they **must not receive a second initial free Battery gift**. But **no permanent email/device fingerprint/national ID collection or tracking** is authorized to enforce this.
4. **S2-10:** registration/login may proceed while first-gift eligibility is unverified; initial gift must remain **PENDING_VERIFICATION**, without side effects. No arbitrary gift amount, wallet, FEFO or expiration rule introduced.
5. No new D1, Worker, Secrets, Queue, storage, paid plan, remote OAuth/identity or deployment from this proposal.

## 2. Machine-readable privacy inventory

See [`m2-privacy-retention-review.v1.json`](./m2-privacy-retention-review.v1.json): 11 bounded data classes, each owner, preliminary disposition, third-party propagation dependency, PITR requirement, and explicitly **null** legal basis/retention duration; all `approved=false`.

| Data class | Default review direction, **not final legal judgment** | Authority / dependency |
| --- | --- | --- |
| Member five-field profile + public cache/search | Delete/anonymize general personal data, revoke public projection | AI-1; later API/cache owners |
| Provider identity/subject + authentication mapping | Delete general identity mapping subject to independently reviewed exceptions | AI-1 / official provider |
| Sessions/refresh hashes and OAuth attempts | Revoke first; erase credentials/verifier at approved lifecycle boundaries | AI-1, key custody |
| Free Battery first-gift eligibility/history | **HOLD**, not issue grant, no arbitrary permanent identifier | AI-3 + AI-1 identity authority + legal/security owner |
| Billing/payment/refund records | Individually assess any real legal obligation, limited use and duration | AI-2 / provider / legal |
| Audit/outbox, notifications, appeals, admin evidence | Minimize per purpose, avoid tokens/raw PII, review exceptions per type | domain owner + AI-3/privacy |
| Backups/PITR and external processors | Reconcile against an independently protected deletion/revocation authority before opening service | AI-0/AI-3/AI-4 and contracted processors |

A one-size-fits-all retention year count would be invented; legal owner must fill the nulls, documented for Q104/Q119, before any real deletion/retention path is claimed complete.

## 3. M2 deletion boundary: independent transaction, not a fake live workflow

Proposed acceptance sequence:
1. **Accept a valid deletion request** via an accessible channel; verify current member authority and approved confirmation/step-up; record reviewable request status. Do not block receipt merely because final legal implementation is pending. Never log bearer, provider code/nonce or raw identity proof.
2. **AI-1 source transaction:** transition member to deleted with monotonic auth/version + all Session revocations, remove general public profile/search visibility, emit the *minimum committed source outbox intent* as allowed. All source changes must be atomic within the actual authority boundary; do not assume atomicity across different D1 databases.
3. **Downstream:** consumers reconcile approved redacted events with idempotent inbox/outbox. Retry and DLQ cannot be treated as completed erasure; external processor propagation must be tracked by purpose and verification state. Revoked/deleted user Session cannot authorize new general notifications.
4. **Physical erasure / limited lawful record retention:** type-by-type approved schedule, least-access scopes and verifiable completion; do not keep revoked email, device ID or provider subject indefinitely just to support first-gift de-duplication.
5. **Recovery:** keep an independently protected anti-rollback/deletion witness *outside the same rewindable data authority*. A proposed witness may hold only a lawful, minimized opaque operation/version reference with independently reviewed custody/access and retention. A restored snapshot must be quarantined until witness reconciliation + reapplication of deletion/revocation fences succeeds, including late effects and failed/partial replay. **No independent witness presently verified.** M4 performs actual recovery drill; this document does not claim real anti-PITR proof.
6. **Completion status:** distinguish received / verified / source committed / propagation pending / erasure confirmed / exception approved / recovery-validated. No automatic success response while critical required steps remain pending.

## 4. First-gift exclusion without illegal permanent tracking

This is a **product requirement plus a legal/identity-coverage problem**, not solved by hashing email (a stable hash may still enable tracking). Until legally approved eligibility signal, source, expiration and verification are established:
- All new/returning accounts may use allowed login/signup.
- First Battery gift is **PENDING_VERIFICATION** and grant is **OFF** for everybody. Do not silently grant when the eligibility service is unavailable, unknown, replayed, or after restore.
- Do not infer "same human" from matching email/name, and do not claim perfect cross-account detection from provider subject alone (provider identifiers may change; cross-provider linkage is not automatically authorized).
- Candidate paths for legal/security consideration only: (A) an approved privacy-minimal server-origin eligibility proof from a lawful authority; (B) approved, accessible manual review with strictly limited proof lifecycle; (C) keep gift HOLD if no lawful reliable mechanism exists. **No solution chosen**, no actual regrant/denial algorithm authorized. Must handle provider unlink/change and cross-device account reuse only after approval.
- Gift grant, if later approved, requires an **atomic idempotent decision with the Battery domain as sole writer**. A signed request or raw `eligible:true` JSON is not enough. No billing or money connection.

## 5. Test/negative-exit specification

- Deletion accepted then two-device sessions revoked; old bearer/refresh rejected; public/search/cache projections removed.
- Write failure at member version, session revoke, outbox and commit: no partial "deleted" success.
- Clone pre-deletion DB snapshot, restore offline, attempt old token / refresh / profile read / Battery gift: all reject until **independently evidenced** anti-PITR replay/fence; failed replay never opens service.
- Competing delete + first-gift + re-registration; unknown/replayed/source-ambiguous eligibility: gift remains pending, no duplicate grant, no tracking side data created.
- Legal hold missing basis/period/access control: no retention authorization. Processor failure/queued task doesn't count as completed erasure; evidence must be minimal and versioned.
- Test-only local hold boundary [`../src/m2-privacy-hold.ts`](../src/m2-privacy-hold.ts) + [negative tests](../test/m2-privacy-hold.test.mjs) **always refuse executable authority**, even if caller attempts `approved:true`. They are NOT wired to live Auth/Battery/restore and do NOT implement deletion or grant.

## 6. Blocking decisions and integration handoff

- **AI-0 / legal-security:** Q104/Q119 itemized legal basis and retention periods, deletion request/processor evidence policy, independent anti-PITR witness custody; approve/reject one lawful first-gift exclusion proof model. Sign off policy before runtime expansion.
- **AI-1 M2:** implement member deletion/auth-version/session revoke/identity erasure based on the approved policy, no cross-owner DB direct writes.
- **AI-3 M2/M4:** Battery status/eligibility gate, privacy/audit evidence and negative recovery tests; only after approved contracts implement a genuinely enforceable admission and exactly-once *business* effect via idempotency, not exactly-once Queue.
- **AI-4:** validate actual Worker/D1 resource topology and environmental Gate; don't use existing Echo/legacy D1 or turn on a blocked production route.

This is a separate minimal review-safe AI-3 slice, not a third mock factory or repeat of W3. **Release gates G00–G10 remain blocked**. Main merge, cloud deployment, real DB/erasure, retention schedules, paid resources and H-Global/Echo remain outside this PR.
