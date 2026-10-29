# M1 AI-1 local Auth issuance implementation and validation boundary

Updated under AI-0 M1 implementation authorization #2 comment 6511165892.

## Implemented in this Draft
- `src/m1-local-auth-session-core.ts`: explicit OFF-by-default, Starry development/staging and HTTPS origin; reuses existing `createVerifiedOidcCallback` for RS256 signature, pinned issuer/audience/JWKS, nonce and PKCE, one-time attempt CAS, stable provider+subject lookup only (no email/name linking), managed non-extractable HMAC key injection, real signed bearer via existing `signServerSession`, single guarded `INSERT SELECT` into original session table using current member/auth_version/provider fence, and delegation to unchanged W3 GET five-field read/final current SQL fence. No new public route.
- `schema/002_m1_local_oauth_attempts.DRAFT.sql`: single-source local table for one-time attempt with durable consumed timestamp, strong constraints. **Do not apply to production**; code verifier must receive secret custody/encryption-at-rest/TTL cleanup in approved remote implementation.
- `test/m1-local-auth-session-core.test.mjs`: test-only generated RSA/JWKS and HMAC keys; in-memory SQLite actual CAS and prepared INSERT; positive roundtrip and negative replay, bad signature/nonce, unknown subject, wrong scope, suspended member, key/SQL failures, and post-issuance revoke/identity unlink/auth_version bump.

## Security and transactional boundaries
The existing OIDC callback consumes the attempt atomically before code exchange, so one callback is the sole winner. A failed exchange consumes the attempt and requires fresh login. The Session INSERT uses a **single atomic guarded SQL statement** (authoritative SQLite instance). This is not a cross-D1 or multi-table transaction; no member provisioning automatically occurs, and provider-subject bindings must already be trusted and present. No token is returned until changed rows == 1. Any session revocation requires current Auth check on each GET. Keys are never stored in git; test-only provider material is generated in-memory and not a production exchange.

## Remaining remote and release gate evidence
No real Apple/Google authorization callback, pinned JWKS fetching/rotation, managed HMAC keyring, external trusted OAuth exchange credentials, approved physical D1 placement/migration, Worker binding, SDK route, Cloudflare staging runtime or production deployment is wired. M0 AI-4 owns platform/runtime/guard/CI. Source-local tests must not be interpreted as remote authentication. G00-G10 remain blocked; no release, deploy, cross-brand or store authorization from this PR. M2 deletion, durable audit/outbox and anti-PITR are separate and must not be falsely claimed.

The earlier document-only stage was superseded by the actual M1 source/schema/test files in the same Draft #266.
