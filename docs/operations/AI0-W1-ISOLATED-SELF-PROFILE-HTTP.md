# AI-0 W1 isolated self-profile HTTP composition
2026-10-29 Taiwan. Refs #1 #2 #5 #220, source base #243 exact 4638621d3408019a1c3660c8f13177cf2bedea6d.
Execution owner: AI-0, not an AI-1/AI-4 delivery or automatically awakened chat.

## Incremental behavior
Existing Worker only serves health; AI-1 already implements signed session verification, current Member/Session/provider lookup and profile domain logic. This slice composes these existing modules into an isolated GET handler. It is not imported by apps/api/src/index.ts, has no fetch entrypoint or deployment binding, defaults OFF and rejects production/foreign brand/app constructors.
Candidate path follows AI-1 /v1/starry-id/members/me. The separate older /v1/member/self draft remains untouched and is not an alias. This is an integration-scoped path choice, not a claim of published OpenAPI/SDK parity.
Source IDs: 01.03/01.04/02.01/02.09; read-only minimum profile. No profile editing, deletion API, issuance, OAuth code exchange, Billing or admin action is added.

## Security and transaction boundary
- Existing R23 verifier validates actual signed bearer and current DB records; cookies, forged client flags and foreign scope cannot authorize a request.
- The principal intentionally hides provider subject. The same existing crypto verifier runs again to obtain signed provider evidence for the final SELECT; no new token parser or signing implementation is introduced. This costs an additional local verification/key lookup and fails closed if key availability changes.
- A single final SELECT joins exact member + session + signed provider/subject association and validates active/current version, app/environment, no revocation and unexpired session. This prevents profile disclosure after revoke/delete/version/unlink in between initial authentication and snapshot query.
- Time is from a trusted server clock; reject rollback, expiry or requests exceeding five seconds after asynchronous dependencies. This is an engineering freshness fence for this isolated reader, not an owner-approved global session lifetime.
- Output is an explicit six-field projection, no spreading private DB columns. No-store headers on all outcomes; no SQL/key errors or bearer in responses.
- Success is a read snapshot only: no write/Queue/entitlement authority, no claim that data cannot change after the final snapshot, no cross-D1 atomicity claim.
- D1-shaped port is tested against actual SQLite :memory: with original draft SQL. This is not true Cloudflare D1/live provider verification.

## Contract discrepancy resolved only within this slice
AI-1 openapi.DRAFT.yaml requires profile_revision>=1 while apps/api/openapi.member.DRAFT.yaml allowed 0. This reader requires >=1 consistent with the current Auth adapter and SQLite schema. Neither immutable source is edited. AI-4 still must reconcile shared OpenAPI/SDK before any Worker registration.
Only GET is supported; other methods return 405/Allow GET; aliases/foreign host return 404; query-selected identity returns 400 before DB reads. Anonymous/invalid/currently revoked auth returns generic 401. A final snapshot race returns 403. Disabled, invalid clock, malformed DB projection or final DB exception returns generic 503. Initial verifier DB/key failure may map to 401 because existing boundary intentionally returns null for all identity failures; no retry/status distinction should be inferred by a future client until AI-1/4 review.
No raw OAuth email, refresh hash, provider subject or private future columns leave this handler.

## Verification and limitations
node --experimental-strip-types --test apps/api/test/ai0-w1-isolated-self-profile.test.mjs
Eight local tests use real WebCrypto nonextractable HMAC keys and actual SQLite, including success projection, disabled/scope/route/method/credential negatives, current revocation, interleaved revocation/deletion/version/unlink and clock/database faults.
New source lies under the existing root TS/lint include, test under existing npm test glob. No CI workflow changes. New exact-SHA CI must independently pass; do not borrow #243 success.
Root source integrity/release denial checks must keep old owner blobs unchanged. Official G00–G10 remain blocked, P05/PUBLISHABLE=false and release_authorization.granted=false.

## Next integration and rollback
AI-1/4 review route/DTO/errors/read snapshot and official key/D1 adapter under W1. Formal Worker remains health-only; no live endpoint claim. AI-0 may collect Owner W1 results and integrate a new Draft, without changing their fixed #242 base.
No main merge, deployment, real resources/secrets, paid service or release gate modification. H-Global and Echo untouched. Rollback is discard this independent Draft's three added files; #243/#242 and original owner code remain unchanged.
