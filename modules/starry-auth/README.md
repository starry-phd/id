# AI-1 | Starry Auth and Member v0.1
Status: SECURITY POLICY KERNEL / D1 SCHEMA / OPENAPI CANDIDATES ONLY. NOT DEPLOYED.
Issue #2; AI-0 Gate #1; ADMIN-PREP #13; AI-4 integration #5.

Ownership: AI-1 owns Starry immutable s_user_id, Apple/Google (provider, stable subject) mapping, session version/revocation, members, and scoped admin authorization. AI-4 owns Expo/Workers/OpenAPI/CI foundation. AI-3 owns audit/event record schema. This PR intentionally changes no AI-4 shared code, root workspace or H-Global resources.

Security: validate OIDC signature using trusted JWKS + issuer/audience/nonce + PKCE before constructing VerifiedPrincipal. The included binding function is NOT a signature verifier. Always read trusted scope and current persisted member/session/grant on the server. Suspended users, revoked sessions, stale auth versions and cross-brand/app/environment scopes fail closed. Non-read admin actions additionally require a fresh persisted step-up. Exact admin roles, MFA, approval rules, full profile fields and deletion retention require AI-0 product Gate approval. Never link accounts by email or name.

Disposable test commands (from repository root):
  tsc --project modules/starry-auth/tsconfig.json --noEmit
  node --experimental-strip-types --test modules/starry-auth/test/*.test.mjs
  python3 -m unittest discover -s modules/starry-auth/test -p test_schema.py -v

Draft schema not applied to any remote D1. Refresh token rotation needs an atomic SQL compare-and-swap; only issue a new token on exactly one changed row. Persist token hashes only. Distinguish confirmed replay from untrusted random guesses before revoking a token family. Future member cross-brand sync stays FEATURE_DISABLED with no calls, records or database connection.

ADMIN-PREP: P03 candidate protected domain API, P04 independent Starry grant scopes with action/resource/app/env and mandatory step-up. Other P01/P02/P05/P06/P07/P08/P09/P10 integration owners remain AI-4/AI-3. No full admin console or 60 empty APIs.

Blocked: AI-4 Worker scaffold, real cryptographic OIDC/JWKS/PKCE implementation, D1 concurrency integration tests, secure web Cookie/CSRF and rate limiting, audit adapter, complete member privacy decision, AI-0 Gate. No Production, live login, billing, or H-Global implementation.
