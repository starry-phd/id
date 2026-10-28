# AI-0 R005 Original-owner integration and Gate 1-3 audit
Date: 2026-10-28. Scope: offline draft, no merge, deployment or spend.

Base AI-0 R005 #211 exact SHA 86b0c66a62810ae1bff724054ec66e70e933cce5; this inherits four-owner R004 integrated #208 plus AI-0 offline canonical HMAC tests and mandatory CI coverage guard. Importing 12 original Git blobs without reauthoring from AI-1 PR #210, AI-2 PR #213, AI-3 PR #212 and AI-4 PR #209. Add AI-0 manifest, review, and executable cross-owner test only.

## Facts from originals
- AI-1 R005: sealed synthetic HMAC P05 event to R004 actor/session fence, no real signed issuer/KMS/monotonic D1 authority, no live Queue.
- AI-2 R005: same-member dual OS signed Auth reviewer via R003 identity port, no official Apple/Google/RevenueCat signed receipt or durable rights, never Store/restore/charge/grant.
- AI-3 R005: Python SQLite :memory: receipt CAS and a second simulated memory connection for anti-PITR tests. This is NOT physical D1 nor an independent durable witness, and never ACK.
- AI-4 R005: AdMob Mediation selected Q4=A, Native UMP/ATT/underage mock consent gate and protected error-only API; never installs SDK, requests ad, or opens Worker routes.

## New Gate1 finding: two incompatible proposed P05 cryptographic envelopes
AI-0 R005 uses contract starry.ai0.p05.canonical-hmac.r005.offline-proposal, an event/signature_hex payload with payload_sha256 and AI-0 domain-separated JSON array.
AI-1 R005 uses contract starry.auth.p05-envelope-r005.v1-offline-candidate, envelope/mac with auth_version, session_version and expires_at and a different HMAC signing-byte domain.
These cannot be assumed interoperable despite both accepting synthetic WebCrypto HMAC tests. AI-0 will NOT silently convert formats, endorse a live issuer, or consider structural verified flags as proof. Flag mismatch to next round: choose ONE versioned canonical P05 envelope and verify negative cross-dialect tests, issuer ownership/KID, lawful Q104/Q119, durable claim CAS and anti-PITR witness only after owner gates. Gate1 PARTIAL/BLOCKED.

## Gate2 same SHA CI
Requires new Draft HEAD actual GitHub Actions success for AI-0 four-owner full offline, AI-1 auth and AI-2 billing; verify 12 original bytes, cross-owner signatures, immutable denial, SQL memory and AdMob OFF. Independent Cloudflare Workers Builds results must be checked separately and never inferred from GitHub CI.

## Gate3 release BLOCKED
G00-G10 11/11; P05/publishable false, Ads OFF, Battery permanently free, no main merge/deploy/real Store/Cloudflare/D1/Queue/EAS/SDK/paid resources. Q5 new private consumer monorepo deferred; existing central Expo54 unchanged. H-Global outside scope.
