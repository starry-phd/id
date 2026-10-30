# AI-4 M1 Starry-only staging capability review pack — NOT AUTHORIZED / NOT PROVISIONED

Authority: latest development standard integrated v1.0 (2026-10-29) and its owner decisions/S2 additions (2026-10-30), workflow v3.0, UP-01/02/04/09/10/13/15/17/18/19/20/22; GitHub Issue #220, AI-0 #1, AI-1 #2, AI-4 #5.

This document is a **proposed finite resource pack**, not a request to create resources and **not** a claim of deployment, live identity or expense approval. The owner has indicated a US$10/month *additional-cost preference*, excluding existing subscription charges. This is neither a provider-enforced hard cap nor a blanket approval to spend.

## Evidence baseline (AI-0 read-only inspection; do not duplicate or extrapolate)

See https://github.com/starry-phd/id/issues/220#issuecomment-6511951607 .
The existing Starry id-starry Worker reports bindings=[]; two older preview Workers have no D1 binding. The two D1 databases identified by AI-0 belong to Echo/legacy, not central Starry membership. Do not read their data, bind them, clone them or reuse them. No verified Starry-specific central D1 was found. The owner reports existing Workers Paid US$5/month; billing plan, usage, quota and prices are **not yet billing-verified**. The existence/settings/redirects/consent of a Google OAuth Client are unverified. No account IDs, client secrets or credentials should be posted publicly.

## Precise Starry-only proposed resource mapping (all PENDING)

| Component | Proposed identity / environment | Scope and blocking preflight |
| --- | --- | --- |
| Cloudflare account | Existing Starry-owned account, ID and roles to be verified read-only | Brand=starry, app_id=starry-id, environment=staging; verify owner, roles, current plan, existing named resources and remaining allowance |
| Worker | Proposed NEW id-starry-m1-staging; NOT existing id-starry | Limited to approved test identities and exactly reviewed source SHA; builds remain disabled; no general public membership route |
| D1 | Proposed NEW id-starry-m1-staging, isolated from other brands and production | Sole authority for M1 test member, identity, Session and minimal audit; migration and transaction semantics review before remote apply |
| Binding | Proposed STARRY_SESSION_DB, only on this Staging Worker | No actual binding exists; obtain and verify resource mapping, strict app/environment, no production alias or access to Echo/legacy |
| Google OAuth | Preferred first official test provider; OAuth project/Client/redirect unknown | Verify issuer, client type/audience, approved HTTPS redirect, PKCE/state/nonce, consent tester, revoke rights; test identity credentials controlled only by owner |
| Callback | Prefer *research* workers.dev for HTTPS + valid Google OAuth redirect | No route/DNS/Worker is approved. If invalid or unsafe, propose separate subdomain for owner approval rather than silently changing existing DNS |
| Managed keyring | Starry-only, non-extractable signing keys and versioned KID; storage unselected | Verify available provider and secure binding/rotation/revocation before any real Session issuance; no keys in Git |
| API/SDK/App | Exact five fields: s_user_id, display_name, directory_opt_in, display_name_public, profile_revision | HTTPS, Starry-only auth/App/env; local platform transport and SDK are source-only. No production route. Expo54 maintained unless a real upgrade trigger |
| Test access | Owner and explicitly named dedicated test identities ONLY | Plan least privilege, explicit invite allowlist, access/audit logs, emergency revocation; no authorization to open public staging |
| Time window | Limited M1 testing period to be selected by owner | Expiry, log retention, cleanup, resource shutdown and rollback are required before creation |

## Data protection and capability gate

M1 local OAuth attempt SQL is DRAFT only and cannot be applied remotely without encrypted code_verifier-at-rest, time-limited cleanup, Google trusted JWKS, provider-specific subject mapping, real managed keyring, approved D1 transaction semantics, least-privilege access and revocation tests. Never link users by email/name or reuse H-Global/Echo member DB. Tests must reject wrong issuer/audience/nonce/state/expiry, app/brand/env and bearer replay, inactive user, token version bump, expired/revoked Session and wrong permission. Preserve source audit, do not output identifiers or secrets in public CI.

General member personal data deletion, necessary legal retention, backup/PITR restoration and anti-regrant controls require approved Q104/Q119 matrix; no permanent email/phone/device fingerprint retention. Battery is permanently free. Initial Battery bonus remains PENDING eligibility review, never pre-granted when anti-repeat legality is unresolved. Ads OFF; no RevenueCat/Store test product creation.

## Cost and stop rules (amounts intentionally PENDING independent verification)

| Cost source | Known evidence | Before authorization |
| --- | --- | --- |
| Cloudflare basic subscription | Owner reports Workers Paid US$5/mo (unverified by billing) | Verify bill and included quotas; existing baseline is not part of *additional* US$10 intention |
| Worker requests, CPU and logs | No newly authorized Worker; incremental amount unknown | Forecast test volume, CPU, retry/log amplification, rate and billing cap availability; CPU time limit is not a total bill cap |
| D1 reads/writes/storage/backups | No authorized central Starry M1 D1 | Estimate reads/writes, storage, time-travel recovery, rates/overages and quota enforcement |
| Google OAuth, domain and operations | Provider state unknown | Verify plan, credentials and any paid product or domain |
| Actions/Expo | CI alone does not prove zero costs | Verify current plan, minutes/quotas, optional jobs and stop conditions |

If prospective *additional* spend approaches or exceeds US$10/month, suspend optional, controllable tests and request a new owner decision; do NOT upgrade or accept charges autonomously. Do not claim a hard financial ceiling absent platform confirmation. Already incurred/lagged or fixed charges may continue even after suspending tests. Stop path: stop optional load and OAuth callbacks; remove test access/credentials; disable staging routing; preserve approved redacted audit; then review actual resource cleanup and deletion/anti-PITR evidence. Any remote delete/Cloudflare account mutation requires separate explicit approval. Git revert cannot restore remote Workers Builds safety settings.

## Formal review and remaining evidence

To request resource setup, AI-0 should first present verified account/resource/roles names, Google redirect/client status, tester allowlist, exact monthly cost/maximum usage and stop/rollback proposal, then obtain item-by-item owner approval. Until then: account/read-only inventory is informational, source-only M1 transport+SDK is not enabled, and staging is NOT provisioned. Gate G00–G10 all remain BLOCKED. P01/P02/P07/P08/P09/P10 and G01/G02/G03/G08/G10 require independent runtime/provider/remote evidence when authorized. No H-Global/Echo development or shared data.
