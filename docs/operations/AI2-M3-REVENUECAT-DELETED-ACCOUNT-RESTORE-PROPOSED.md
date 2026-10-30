# ADR (proposed)｜Starry M3 RevenueCat trusted purchase & deleted-account entitlement restore

> Status: **PROPOSED / REVIEW REQUIRED**, source-only, NOT a grant, approved transfer policy, deployed endpoint, legal retention decision, or third-party configuration permission.
>
> Owner: AI-2 Billing; co-review: AI-1 (Starry Auth/member ownership), AI-3 (deletion/PITR/audit), AI-4 (SDK/Worker ingress), AI-0 (architecture/owner decisions).
>
> Engineering baseline: `starry-phd/id` main `6bd75447d707365c90768aa1578de7098802db2d` (2026-10-30). M0 #267, M1 local #266 merged, **not** official OAuth/remote-D1/staging evidence. No M3 purchase/provider system is live.
>
> Normative source: [最新開發技術規範 v1.0 + 2026-10-30 S2](https://docs.google.com/document/d/1urLja9i9A63jHuz4jQPhPMTgoCtoq-i1TafXPQd3PYU) — UP-01/02/03/04/11/13/14/15/17/18/20/22, S2-11/12/13, sections 4.1 and M3; [#220](https://github.com/starry-phd/id/issues/220); [AI-2 #3](https://github.com/starry-phd/id/issues/3). This document does not supersede the specifications.

## 1. Fixed constraints (already approved, not a new proposal)

- RevenueCat is the selected **thin-client purchase-integration provider**, not an alternate member database or client-side authorization authority. Store is the original purchase source; AI-2's central trusted Billing projection owns entitlement decisions, reconciliation and committed outbox. No competing parallel self-built Store authority. Server-verified Starry member **must** exist before a purchase; cancelling sign-in must start **no** transaction.
- Each app has its own app/Store/project/environment/product-to-entitlement mapping. A still-valid entitlement for the **same Starry member in the same App** may be available on both iOS and Android after central verification; **App A never unlocks App B**, and this does not migrate an Apple purchase to Google or vice versa.
- Allowed product *types* remain non-consumable lifetime and monthly/yearly auto-renew subscriptions, separately or combined as already decided; cancellation/expiry must not remove a valid lifetime entitlement. Battery is permanently free, Ads OFF.
- **Never** trust client `appUserId`, paywall state, cached `isActive`, email/name/device ID, caller-supplied `s_user_id`, user-supplied Store scope, or bare `restorePurchases` success as a member ownership or grant proof.
- All official Store/RevenueCat project IDs, app identity, environment and provider authority are derived server-side and cross-checked against the approved registry and verified provider response. No SKU/project/account ID is fixed here.

## 2. Already present code and its limit

- [`packages/rebuild-billing/src/trusted-store-namespace.ts`](../../packages/rebuild-billing/src/trusted-store-namespace.ts), Blob `e7a8734980f23282750e5701d0721f44b70fe782`: versioned **six trusted scope dimensions** (Starry brand, app, Starry runtime env, official Store app, verification env, provider authority) plus provider axis; distinct receipt, original-first-claim and event identities. Constructor and official-scope freeze snapshots. **This is an offline test-only builder, NOT an Apple/Google/RevenueCat verifier, Store grant or live adapter.**
- [`modules/starry-id-v1/src/billing-bridge.ts`](../../modules/starry-id-v1/src/billing-bridge.ts): draft server-issued, per-request member/binding bridge; it does not itself decide receipt or entitlement ownership.
- [`modules/starry-id-v1/src/m1-local-auth-session-core.ts`](../../modules/starry-id-v1/src/m1-local-auth-session-core.ts): merged **local-only** M1 callback/session core; no live Auth/Billing client association. Do not treat an M1 locally issued bearer as proof of a real official provider login.
- Existing W1/W2/W3 Billing registry/writer candidates remain traceable; do not rewrite/merge historical SQL or invent cross-D1 atomic transaction semantics merely to implement this ADR.

## 3. Proposed M3 authority flow (not yet implemented)

1. **Auth gate:** Verify *current* server-issued Starry principal, active member/session/version and server-approved target App/env. Before any purchasable action, the authenticated binding must resolve to the intended server-owned opaque RevenueCat member identity. Never synthesize a member from an RC anonymous alias or from the device.
2. **Thin client:** `identifyUser`, offerings, purchase, observe, restore and logout may request UX operations only; no direct central grant. Per-App typed product mapping is server-approved; client cannot select arbitrary entitlement keys, RC project, or Store account scope.
3. **Provider ingestion:** Authenticated, validated provider notification enters a **durable inbox** with replay identity. Persist acceptance before responding success; fetch or reconcile authoritative provider/Store purchase state using a trusted server port under actual plan/API constraints. Webhook signature semantics, retries and API limits are **unverified account-specific dependencies**, not assumed here.
4. **Single trusted Billing writer:** From server-owned config + verified provider/official Store evidence, derive receipt identity `(provider, namespace, transaction_ref)`; immutable **original lineage first-claim** `(provider, namespace, original_ref)`; independently dedupe `(provider, namespace, provider_event_ref)` so multiple refund/renewal events aren't suppressed. Do not include member/session in lineage key. Resolve membership binding under DB uniqueness/CAS and apply grant/revoke plus committed outbox in the same Billing transaction; across D1 boundaries use inbox/outbox/compensation instead of imaginary atomicity.
5. **Read entitlement:** Central AI-2 projection must check correct member, brand/App/env/product mapping, current verified ownership, period, refund/revocation and freshness. A stale client/provider cache cannot overwrite a later revoke. If current verified evidence is unavailable, **no new grant**; previously valid offline grants only under a separately approved bounded policy.
6. **Reconcile & audit:** Use verified notification + trusted API/restore; dedupe replays, reorder events by authoritative transaction state, reconcile missed revoke/chargeback and record sanitized evidence. Expose durable source/event receipt and state transition provenance without storing public receipts, purchase tokens, emails or full PII in repo/CI artifacts.

## 4. S2-11 account deletion → purchase restore / rebind: proposal pending owner choice

**Distinguish these cases explicitly:**

| Situation | Safe current treatment | Later decision/evidence |
| --- | --- | --- |
| Existing, active Starry member restores a purchase **already attributed to the same member and scoped App** | Verify current member + authoritative provider purchase; reproject same-member valid entitlement; no ownership transfer or client-only grant | Real Store/RC sandbox and refund tests before live enable |
| Member signs into another device/platform using the **same Starry ID and App** | Retrieve centrally verified entitlement; do not duplicate transaction, move Store ownership or grant another App | Cross-platform policy and Store evidence |
| Deleted Starry account, new Starry ID presents a purchase originally attributed to deleted ID | **Hold/deny automatic ownership transfer and new grant; review required**. A valid purchase may exist, but provider ownership alone is not proof of authorization to move previous Starry attribution | Owner must choose a supported rebind policy; legal retention/erasure and lawful minimal ownership evidence; provider alias/transfer semantics and platform policy |
| Existing transaction already first-claimed by a **different active** Starry ID | Conflict; fail closed, do not silently alias/merge/steal entitlement | Explicit consent, strong ownership evidence and controlled recovery path; security review |
| Refunded/revoked/chargeback/expired subscription (without independent lifetime grant) | No new grant; revoke according to verified state | Reconcile authoritative event state, refund freshness, audit |
| Lost purchase record, stale backup/PITR restores older entitlement state | Fail closed on disputed state; revalidate against durable revocation/deletion evidence | AI-3 approved anti-PITR/recovery witness and rehydration tests |

**Policy choices requiring explicit owner/AI-0 + AI-1/AI-3 security/legal review (none selected here):**

- **A — Conditional self-service transfer:** after new Starry ID authentication, independent official purchase proof, original-claim conflict checks, anti-replay/cooldown/risk challenge, legally adequate deletion/ownership evidence and auditable one-time CAS transfer. *Not permitted until all conditions and platform rules are verified.*
- **B — Manual reviewed rebind:** secure support case with least-privilege adjudication, required proof and an auditable approved authority action; no access to other member PII. This avoids an automatic claim but adds operational/privacy cost.
- **C — No cross-ID transfer:** remain blocked for new ID, offer store-directed subscription management/support. Must evaluate the platform's restore expectations, consumer rights and owner-approved customer messaging first.

The proposal **does not** treat C as finalized or require indefinite receipt retention. Deleting an account is **not** cancelling the Store subscription. The previous account's general PII must be erased as legally required; retention of finance/anti-fraud/minimal first-claim evidence only if the itemized legal basis, purpose, TTL, access policy, provider propagation, data minimization and anti-PITR recovery treatment are approved. No permanent email/phone/device fingerprints. A user may re-register while Battery first-gift stays pending separately; Billing cannot silently reuse Battery anti-regrant identifiers.

**Minimum state machine for future contract review:** `unlinked` → `pending_official_verification` → `same_member_valid` or `conflict_hold` / `revoked`; deleted-account recovery only `conflict_hold` → `review_approved_transfer` *after* chosen policy and evidence. State names are illustrative, not an approved DB migration, API or product entitlement.

## 5. Concrete acceptance/negative cases for future M3 main PR

1. Anonymous member, expired/revoked Session, cross-App/brand/env, body-supplied `s_user_id` or RC alias `anonymous` → **no purchase initiation or new grant**. Login cancel → no Store transaction.
2. A valid original transaction for App A / Store project P1 → no App B grant, even same `s_user_id`; A iOS ↔ A Android central read may share only eligible entitlements under the same Starry ID, not Store ownership.
3. Same `original_ref` first-claimed by old/deleted ID, then `restorePurchases` from new ID → **hold**, no silent transfer or new grant. Same case with different active ID → conflict hold. Subsequent duplicate recovery requests do not create additional grants.
4. Trusted Store app, environment, provider authority or approved RC project mismatches server registry; unknown project/issuer, stale provider state, spoofed client `isPremium` → deny. Probe independent App/Store authority namespace collision and Unicode/delimiter inputs using existing W3 tests, not duplicated logic.
5. Webhook replay, reorder, concurrent restore vs refund/chargeback, distinct refund events on same receipt; transactional event ID != lineage first-claim ID. No stale active entitlement reappears following revoke or a backup restore.
6. Active same-member valid lifetime purchase + expired subscription: keep lifetime, expire only subscription-derived features. Never make Battery purchasable; Ads remain OFF until separately approved.
7. Provider unavailable after webhook ingest, API 429/5xx, duplicate delivery, failed durable persist/outbox, partially completed ownership proof: fail closed for **new grants**, don't ACK unpersisted inbox or turn a timeout into success; recover with idempotent retry, scoped audit and explicit source freshness.
8. Delete/restore: no general PII retained without approved legal basis; replay of a pre-erasure backup must not resurrect personal data or previously revoked entitlements. Validate notification/receipt retention vs erased identity mapping before enabling transfer.

**Evidence levels:** local Node/SQLite mocked provider → workerd/Worker-D1 parity → approved official RevenueCat/Apple/Google Sandbox on named App/project/test identity → independent M3 Gate G04/G05 mapping. Do not report any earlier level as latter or infer fixed pricing/quotas. Include exact SHA, commands, CI, app/env and redacted provider evidence and rollback plan per UP-09/10/14/19.

## 6. External readiness & cost facts to verify, not to create now

S2 owner-reported (NOT independently verified): an existing RevenueCat account under the stated Starry management identity **without a configured Starry project**; developer accounts exist but **no test Store SKUs/products**; Google-first login and dedicated test account; Starry Workers Paid billing plan described but not independently reconciled. Existing/new subscriptions are **not** permission to create projects, webhooks, products, Store mappings, credentials, resources or charges.

After M1's trusted real identity contract becomes available, obtain read-only verification (where connector permissions permit): current RevenueCat plan and limits, webhook availability/verification, REST permissions, app/project mappings and alias/transfer behavior, Apple/Google ownership/test products and sandbox permissions; request **one bounded Starry-only capability/cost package** before any modifying action. Each new paid amount or resource requires specific approval; additional US$10/month is a budget intention, not hard billing cap. Use synthetic IDs, never publish credentials or customer records.

## 7. Explicit decisions / dependencies / rollback

**Decision now:** offline-safe design and negative evidence only; no automatic transfer for deleted identities, no new grants from client, no live RevenueCat integration without project/rights verification. This is a **fail-closed interim safety constraint**, not a final commercial policy.

**Needs owner decision:** permitted deleted-account transfer path (A/B/C); which evidence retains legal basis and TTL; rights/consent of former/new IDs; user disclosure and appeals; provider/project capability and official Store policy; separately approve exact cloud/test/resources/costs. **Needs AI-1:** new Starry ID server-only identity mapping + deletion boundary. **Needs AI-3:** erasure/audit/outbox + anti-PITR witness. **Needs AI-4:** SDK ingress/route/permissions/CI and runtime proof. **AI-0:** coordinate decisions and eventual gate.

**Future rollback:** disable M3 purchase initiation and new grant pipeline via formally approved server flag; keep revocation/reconciliation and audit evidence alive, don't delete financial records or reverse existing refunds. No code/config deploy or state change results from this proposed ADR.

**Source-only status:** no approved live integration, CI tests, cloud/store interactions, product SKU creation, payment, DB migration, deploy or release gate transition for this ADR.