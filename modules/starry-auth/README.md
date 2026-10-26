# AI-1 | Starry Auth / TrustedPrincipal v0.2.0-draft

**Status: contract + pure server-side policy tests ONLY. No live OIDC, Worker route, D1 or deployment.** Owner: `modules/starry-auth/**`; Draft PR #22 / Issue #2. This supersedes the v0.1 principal handoff, not the security guard or database drafts.

## Trusted principal boundary for AI-2 / AI-3 / AI-4

- `src/principal.ts` exports `TrustedStarryPrincipal` and `STARRY_PRINCIPAL_CONTRACT_VERSION = 0.2.0-draft`. Opaque module-issued object, runtime WeakSet provenance, immutable per-request snapshot; JSON or `adminVerified: true` cannot mint it.
- `createTrustedPrincipalResolver({ trustedScope, auth, records })` takes **server-only** Starry brand/app/runtime environment registry, a verifier that MUST already perform OIDC code/PKCE/JWKS, issuer/audience/nonce validation **or** cryptographically validate a session, plus fresh persisted member/session/grant loaders. The verifier is **not implemented** in this PR. The input HTTP request cannot supply admin grants, Starry s_user_id, App scope or step-up.
- Reject inactive/suspended/deleted member, expired/revoked session, stale member/session/auth version and wrong Starry brand, App or Worker environment. On each new HTTP request, re-verify and re-load current DB records. Do not cache this principal across requests. The adapter rejects a principal over 60 seconds old even in the same request.
- `admin_scopes` currently contains only explicitly attested exact grants `billing:refund:review` and `audit:read`, restricted to Starry, current app/runtime environment and matching action/resource. `billing:refund:review` requires backend-persisted `step_up_at` (within **300 seconds**) AND `step_up_until` (still valid). A bare boolean is never authoritative. Member rank or Email is not an admin grant.
- `billingIdentityAdapter(principal, trustedScope, now, storeEnvironment)` supplies trusted `userId=s_user_id`, `appId`, `runtimeEnvironment`, `authVersion`, `sessionId`; `storeEnvironment` **separate** from Worker environment and restricted to `sandbox` for this round. App Store accountBinding must come from a different server-owned verified transaction binding, not from HTTP, and ProviderVerifiedEvent must be created only after actual Apple/Google verification by AI-2 integration.
- `billingRefundReviewAdapter(...)` returns AI-2 `RefundReviewPrincipal`-compatible `brandId='starry', environment='sandbox', appIds, scopes, stepUpAt` if exact grant, current session, App scope and 300-second step-up pass. AI-2 then calls `assertRefundReviewAuthorized` with trusted approval/reason inputs. **Review only**; never executes a refund.
- `auditReadActorAdapter(...)` provides `actor_kind='user', actor_id=s_user_id, permission/action='audit:read'` for AI-3. **No client boolean as auth:** AI-3's present `assertAuditRead(..., adminVerified:boolean, ...)` is an insecure integration boundary if called with client input. AI-3 should accept `TrustedStarryPrincipal` or this server-attested adapter result at Gate 2; do not wire the boolean route before the contract change. P05 canonical EventEnvelope, timestamp validator and serialization stay owned by AI-0 PR #19; Audit records stay owned by AI-3 PR #21.

### Example (illustrative only, NOT a live route)

```ts
// Only AI-4's backend wiring may construct this with real implementations.
// No server verifier or D1 adapters are shipped in PR #22.
const resolve = createTrustedPrincipalResolver({
  trustedScope: serverAppRegistry.starryScope,  // NOT request.json()
  auth: {verifyAfterOidcOrSession: realCryptographicVerifier},
  records: {loadMember: readCurrentMember, loadSession: readCurrentSession, loadGrants: readCurrentGrants},
});
const principal = await resolve(httpRequest, serverEpochSeconds);
if (!principal) return forbidden();
const billingAuth = billingIdentityAdapter(principal, serverAppRegistry.starryScope, serverEpochSeconds, 'sandbox');
// Store binding and transaction verification: separate server-authenticated AI-2 adapter.
const reviewer = billingRefundReviewAdapter(principal, serverAppRegistry.starryScope, serverEpochSeconds, 'sandbox');
// AI-2 asserts refund review reason+approval; this example cannot issue a refund.
const auditActor = auditReadActorAdapter(principal, serverAppRegistry.starryScope, serverEpochSeconds);
// P05 event envelope MUST come from AI-0 canonical validator, not another DTO.
```

**Test evidence:** dedicated CI runs strict TS, Node security tests (including forged JSON, revoked user/session, missing step-up, App/env/brand mismatch), SQLite **in-memory** D1 schema/CAS. Runnable from repo root:

```sh
npm exec --yes --package=typescript@5.8.3 -- tsc -p modules/starry-auth/tsconfig.json --noEmit
node --experimental-strip-types --test modules/starry-auth/test/*.test.mjs
python3 -m unittest discover -s modules/starry-auth/test -p test_schema.py -v
```

**Owned boundaries:** Starry `s_user_id` and provider stable (issuer, subject), independently versioned sessions, member and scoped admin grants; no cross-brand linking by Email/name; disabled future cross-brand sync. Draft D1 schema and auth OpenAPI only. **Pending AI-0 Gate:** approved admin role/privacy/MFA policies, AI-4 real PKCE/JWKS/OIDC + Worker, rate limiting/Cookie CSRF, concurrent D1 CAS, AI-2 store-authoritative binding, AI-3 audit bridge, integrated Gate 2 suite. No Secrets/Production/H-Global/payments or main merges.
