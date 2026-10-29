# M1 Auth → Member round-trip: implementation boundary and live blockers

Status: implementation investigation on main `22f1b303ae5c90ba28caac614a82efd79fd570d9`; no live capability is enabled.

## Confirmed source facts

- `apps/api/src/index.ts` is health-only. It returns 404 for `/v1/starry-id/members/me`; this remains intentional until M0/runtime readiness and the approved route owner complete their gate.
- `modules/starry-id-v1/src/session-crypto.ts` can verify a real HMAC-signed Starry session and `createVerifiedOidcCallback` in `src/oidc-crypto.ts` can validate a callback **only when trusted backend ports are supplied**. It explicitly does not implement live provider code exchange or state persistence.
- `createServerIdentityResolver` requires an already-verified signed-session/OIDC evidence object and current Member, Session and provider-link readers. It is not an OIDC login issuer.
- `createOfflineStarryRequestAuthBoundary` and W3 remain local-only/default-OFF. W3 calls the original self-profile handler and proves local HMAC + SQLite behavior, not a user login.
- The repository's only supplied identity schema is `schema/001_starry_identity.DRAFT.sql`, explicitly marked do-not-apply-to-production. No deployable, authoritative D1 binding or approved physical placement was found in the inspected main source.

## Why the requested true round-trip cannot honestly be marked complete yet

A real login → durable Session → signed bearer requires all of the following to be wired together: trusted Apple/Google authorization-code exchange and redirect configuration; persistent one-time OAuth state/PKCE/nonce with atomic consume; authoritative identity/member resolution and member creation policy; an atomic durable Session + refresh-hash persistence transaction; a managed non-extractable signing key and key-id rotation; a trusted clock; and an approved D1 binding/schema location. The current source exposes interfaces/crypto primitives for some steps, but not a configured end-to-end issuer and durable production-capable persistence path. None of those missing external capabilities can be replaced by synthetic tests or a client-created principal.

## Safe M1 work boundary

1. Reuse W3 and its existing 5-field self-profile DTO unchanged; do not reimplement its handler or alter the public Worker route.
2. Add the issuer/refresh/session-persistence composition only after the server-owned ports and atomic transaction contract are agreed. Key lookup must distinguish unknown KID (null) from provider failure (throw); no tokens, claims, subjects or SQL details in errors.
3. Keep public route and all live flags OFF until AI-4 M0 runtime/readiness and the AI-0 release gate approve the exact artifact and bindings.
4. Required proof must separately name: deterministic local WebCrypto + SQLite integration; actual Workers runtime with mocked/injected provider ports; and, only after approval, real provider/D1 staging evidence. None substitutes for another.

This document records observed implementation gaps; it does not claim that login, issuance, remote D1 or a live endpoint exists.
