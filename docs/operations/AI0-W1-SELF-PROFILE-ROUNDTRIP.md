# AI-0 W1 self-profile client/server round trip
2026-10-29 Taiwan. AI-0 execution; refs #1/#2/#5/#220. Base #244 exact 7965ee9a9b0a80bc595b207382aac75bf7a33548.

## Delivered behavior
A detached, default-OFF integration client reads the existing isolated #244 handler using an explicitly injected local transport. No ambient fetch, default service URL, public SDK export, app entrypoint or Worker registration is added.
Request is exactly GET /v1/starry-id/members/me with verified-format bearer from a caller-provided secure-token port, credentials omit, redirect error and cache no-store. No caller-selected member ID, cookies, token-in-URL, query arguments, mutation or automatic retry.
The client parses only successful JSON/no-store responses from the pinned endpoint. Streaming body reads are capped at 16KiB and cancelled on overflow. Exactly five fields are accepted; extra private fields, unsafe identifiers, wrong booleans, invalid revision, whitespace/control names and malformed JSON fail closed. Errors return bounded codes without response-body/exception/token reflection.
This is not new Auth/token storage or a generated production SDK. The future native/browser credential custody, CORS, server IAM and provider decisions remain outside this slice.

## Contract alignment and correction
New standalone OpenAPI 3.1 JSON describes the implemented isolated route, five fields, revision range 1..MAX_SAFE_INTEGER-1, required signed session and current-record verification; servers=[] and registration/release=false. Existing shared OpenAPI/SDK and immutable owner artifacts remain unchanged.
**Correction to prior #244 prose:** earlier handoff called this a "six-field" projection. The actual code and JSON have always had **five** keys: s_user_id, display_name, directory_opt_in, display_name_public, profile_revision. No new sixth field is introduced. This documentation and executable contract test use the correct count.
The route follows existing AI-1 /v1/starry-id/members/me; /v1/member/self is not an alias. An OpenAPI reference for this isolated slice does not resolve every first-wave source clause or establish official published API parity.

## Verification
node --experimental-strip-types --test apps/api/test/ai0-w1-self-profile-roundtrip.test.mjs
Seven test groups include full client→existing handler→original Auth crypto/current-record SQL→actual SQLite→strict client projection, and a second request after real SQLite revocation. Transport is in-process, not an external service. Remaining negative groups test exact contract parity, default/credential gating, unsafe origins/production, DTO/privacy/body limits, content/cache/redirect rejection and generic errors.
Fixture intentionally reproduces the #244 test setup without changing its immutable test artifact. No mock identity flag replaces verification. The existing original schema and ephemeral WebCrypto HMAC key are used.
New source/test picked up by existing TS/lint/root npm test includes; standalone spec is parsed and checked in the roundtrip test. New exact-SHA GitHub full CI must independently pass before handoff.

## Status and next
AI-0 integration scope only, not proof AI-1–4 executed W1. Owner W1 fixed #242 base remains unchanged. AI-1/AI-4 can review this exact contract/client as part of their existing task and avoid reimplementing the read path. No deployment or official OAuth/D1 native/web E2E claim.
G00–G10 remain blocked, P05/PUBLISHABLE=false and release=false. No main merge, real resources, secrets, paid services, H-Global or Echo work. Rollback discards the four new files on this independent Draft.
