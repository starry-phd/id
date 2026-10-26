# ADR AI-1 REBUILD-001｜Starry ID Identity/Profile/Auth安全垂直切片
**Status: DRAFT / AI-0 Gate pending. Source SSOT:** PR #25 `f9c02e2350fc1cf0311574ac05c3536d9b2900f5`, `docs/requirements/registry.v0.json` (`seed_only`, 25 records), ADR-0001. THIS DOCUMENT DOES NOT APPROVE NEW PRODUCT FIELDS OR ADMIN POLICIES.

## Scope, ownership, approval trace
| Requirement | SSOT status | Scope of this PR |
| --- | --- | --- |
| ID-S-001 | approved | Starry-only `s_user_id`, Apple/Google stable-subject binding, fresh Session/current Member, minimal candidate profile |
| ID-S-002 | approved | Self-only read/update plan, opt-in public projection, deletion + auth_version invalidation, protected admin draft |
| AUTH-001 | approved | Server verifier **boundary**, session revocation/expiry, Passkey/TOTP persisted step-up policy **draft**, no live OIDC/MFA |
| OPS-001 | approved | Protected domain admin exact grant and 5m step-up kernel; role roster/break-glass approval pending |
| DATA-001 | approved | Logical single owner for Starry Auth Member/Identity/Session/AdminGrant, physical D1 count NOT decided |
| SYNC-001 | approved | Cross-brand default disabled, no H-Global services or DB |
| ID-H-001 | approved | OUT OF SCOPE: separate H-Global repo/ID; no H-Global implementation here |
| ID-H-002 / OPS-002 / SYNC-002 | candidate | Not implemented / no implied approval |

## Authority and access matrix
| Operation | Subject | Backend prerequisite | Actual status |
| --- | --- | --- | --- |
| Read own minimal profile | verified Starry member | active, valid session, matching s_user_id/auth_version & App/runtime | Pure guard tested |
| Update own approved minimal fields | same subject | only display_name + opt-in fields, matching CAS revision | Pure plan tested, D1 not wired |
| Publish searchable alias | external viewer | member ACTIVE and double opt-in and nonempty alias | Pure projection only; live search policy candidate |
| Revoke Session | current member | verified session, server-side CAS/revoke and version check | SQL/test prototype only |
| Delete own account | current member | fresh independently server-verified confirmation; transaction revokes all sessions, bumps auth_version, tombstones profile | Pure plan/SQL test; cross-domain deletion events not wired |
| Suspend/restore member | server-authorized Starry admin | exact brand/app/environment + action grant + backend recorded Passkey/TOTP recent step-up | Prototype guard; roles/approval/break-glass candidate |
| Cross-brand data | nobody | DISABLED | No network or H-Global code |

## Worker Auth adapter handoff to AI-4 #5
1. Use Starry-only trusted Worker `{brand_id:'starry',app_id,environment}` registry, never `request.json()` / query claims for scope. Derive Apple/Google OAuth state, nonce & PKCE code verifier from one-time server-side transaction, verify ID token cryptographic signature via trusted, rotated JWKS, exact issuer/audience/azp/nonce/expiry/iat & stable `(provider,sub)` mapping. Or validate a signed, rotated Starry session cryptographically with CSRF protections for cookie auth. This PR's verifier is an **interface only**.
2. Pass opaque incoming request to `createServerIdentityResolver({trusted_scope, verify_oidc_or_session,read_member,read_session,identity_matches})`. Its result is an opaque per-request `TrustedPrincipal` with live status/version/expiry guard. Never mint it directly from client flags, Email/name, or unverified ID token. Backend must handle suspended/deleted users and revocations on every request.
3. Use `readSelf`, `planSelfUpdate` and `planSelfDeletion` only after trusted resolver, with D1 conditional CAS for `profile_revision`, `auth_version`, session revocation and atomically unique account deletion + redacted audit/outbox to AI-3. **Never claim success until transaction changed rows=1.** D1 real concurrency/retry compensation is not tested.
4. `publicDirectoryProjection` is a safe candidate field projection, not an approved live searchable directory; indexing/search, anti-enumeration and individual data visibility fields need AI-0 policy Gate. Do not surface Email/phone/provider subject in public index.
5. Require `requireMemberAdmin` only with persisted Starry AdminGrant, valid same-session persisted MFA evidence. Passkey WebAuthn or TOTP registration, recovery and hardware proof are **not implemented**; recovery/break-glass requires separately approved workflow, two-person control candidate, mandatory audit, short expiry, zero H-Global inheritance.

## Security/test and unresolved risks
- Deletion challenge verifier accepts only backend-validated, one-time proofs; the sample opaque object guard is **not one-time consumption**. Worker/D1 must atomically consume challenge ID with TTL and prevent replay before any deletion.
- Apple account revocation/notification, token refresh rotation/replay, key rotation, cookie CSRF, WebAuthn/passkey RP origins, TOTP secret lifecycle, account recovery, brute-force/rate limits, abuse protections, audit events, delete cascade to Billing/Battery/Notifications are blocked pending AI-4/AI-3 + product Gate.
- SSOT `coverage=seed_only`: don't auto-add H-Global awards/43 ranks, dynamic membership badges, full admin UI, Battery wallet/FEFO.
- No Production, Staging, real D1, Secrets, provider API calls, real PII or deployment. Old Draft #22 is separate historical candidate, not a dependency.
