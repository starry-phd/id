# AI-1 REBUILD v1.1.0-draft — Server-only Starry ID → Billing bridge
## AI-0 2026-10-26 new-architecture Round 2 (#2), stacked on initial AI-1 Draft #27
- **Canonical input:** AI-1 `createServerIdentityResolver` issued `TrustedPrincipal` (WeakSet sealed) per HTTP request, **after** injected AI-4 verifier cryptographically checks signed Starry Session / Apple/Google JWKS+PKCE and authoritative current member, provider subject, Session/auth_version. No live verifier exists in this PR.
- **Output:** `createStarryBillingAuthPortForRequest({scope,resolvePrincipal,readCurrentBinding,nowSeconds}, opaqueRequest)` returns `Promise<StarryBillingAuthPort|null>`, with sync `verifyCurrentIdentity()`. The structural type is compatible with AI-2 #29 `StarryAuthPort` / `VerifiedStarryIdentity`: `{brandId:'starry',appId,environment,userId:s_user_id,accountBinding}`.
- **Account binding authority:** `readCurrentBinding` comes from **server-owned** Starry ID StoreBinding record for exact immutable `s_user_id`, app_id, Worker runtime, store, storeAppId, store environment. Apple `appAccountToken` must be a backend-issued UUID; Google `obfuscatedAccountId` is backend-issued opaque string. **No email/name/HTTP field may mint identity or purchase binding.** AI-2 separately verifies the Apple/Google provider-signed transaction and checks originalTransactionId unique owner.
- **Environment axes:** Worker `environment = development | staging` vs `store_environment = sandbox`. Production runtime/store disabled for this unapproved sandbox contract.
- **Server-only contract:** Every request recreates port after fresh auth and binding reads; port expires in 30 seconds or earlier Session expiry. Do not cache across requests; adapter does **not** convey accountBinding to front-end. AI-4 must own Worker route/SDK and inject verified dependencies; never expose `StarryBillingAuthPort` factory as public API or call it using request.json() as if verified.
- **Negative evidence:** forged client verified/admin flags, JSON identity, revoked/suspended/deleted, stale auth_version, expired session, wrong Starry brand/App/runtime, wrong store/storeAppId/store_env, alien binding, invalid Apple token, expired or revoked binding, slow resolver, stale port, sandbox vs Production. New SQLite in-memory unique binding cross-account + CAS tests.
- **Logical schema:** `schema/002_starry_store_bindings.DRAFT.sql`, **not applied**. Separate AI-2 Billing original transaction ownership and entitlement writer. AI-0 decides D1 physical topology and binding lifecycle/version.
- **Blocking:** AI-0 canonical principal/billing API approval; AI-4 actual JWT/JWKS/PKCE, backend auth/session D1 read, App registry/binding injection, request-only Worker/SDK tests; AI-2 real signed store verification and exclusive original-transaction owner; policy for store account binding rotation/refunds. Cross-brand API disabled. No H-Global implementation/real D1/Secrets, Production/Staging deployment, paid tool, merge main.

### Illustrative Worker use — NOT a deployed route
```ts
const resolvePrincipal = createServerIdentityResolver({
  trusted_scope: backendStarryScope,
  verify_oidc_or_session: cryptographicallyVerifyAndBindStarryRequest,
  read_member: readFreshMemberFromStarry,
  read_session: readFreshSessionFromStarry,
  identity_matches: verifyStableAppleGoogleProviderSubject,
});
const auth = await createStarryBillingAuthPortForRequest({
  scope: serverOwnedStoreRegistry,
  resolvePrincipal,
  readCurrentBinding: readOnlyStarryIdStoreBinding,
  nowSeconds: serverTrustedEpochSeconds,
}, opaqueHttpRequest);
if (!auth) return denyWithoutLeakingPII();
// AI-2 planSandboxPurchase({store,evidence}, {registry,auth,store,ledger}, nowIso)
// must still verify provider-signed sandbox receipt and immutable transaction owner.
```

Test commands from repo root:
```sh
npm exec --yes --package=typescript@5.8.3 -- tsc -p modules/starry-id-v1/tsconfig.json --noEmit
node --experimental-strip-types --test modules/starry-id-v1/test/*.test.mjs
python3 -m unittest discover -s modules/starry-id-v1/test -p 'test_*.py' -v
```
Source: [AI-0 #30 integration Gate](https://github.com/starry-phd/id/pull/30), SSOT seed [#25](https://github.com/starry-phd/id/pull/25) (still incomplete), AI-2 [#29](https://github.com/starry-phd/id/pull/29). Old #22 is a historical Draft, not a source of truth.
