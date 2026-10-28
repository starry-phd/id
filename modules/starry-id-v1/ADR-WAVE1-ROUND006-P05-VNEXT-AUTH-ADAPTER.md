# AI-1 Wave1 R006 — AI-0 P05 vNext read-only Auth SessionFence adapter

**Authoritative proposed contract** [AI-0 Issue #1 #6474929122](https://github.com/starry-phd/id/issues/1#issuecomment-6474929122); **AI-1 task** [Issue #2 #6474937393](https://github.com/starry-phd/id/issues/2#issuecomment-6474937393); last integrated [AI-0 R005 Draft #214](https://github.com/starry-phd/id/pull/214) SHA \`55b8e31a64b62828dbdeb075f38150f02983fa86\`. R005 #210 original byte-for-byte preserved. THIS IS OFFLINE, NOT A NEW AI-0 ISSUER OR OFFICIAL APPROVAL.

- Pin \`starry.p05.canonical.vnext.offline-candidate\` with **17 exact data-only properties** in AI-0's specified order: \`version,purpose,brand_id,app_id,environment,event_id,event_type,actor_ref,auth_version,session_version,idempotency_key,issuer_kid,issuer_epoch,issued_at,expires_at,nonce,payload_sha256\`. Only wrapper \`{envelope,mac_hex}\`. Old AI-0 \`{event,signature_hex}\`, AI-1 \`{envelope,mac}\` and any R005 HMAC domain MUST NEVER be silently accepted; version mismatch is denied.
- Bytes for reviewer: \`JSON.stringify([ 'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1', ...17 values ])\`, nonextractable server-injected HMAC-SHA256 verify-only lease, stable \`{kid,epoch,key}\` before/after each of two checks. Only synthetic test key (generated in test, not committed or used for signing in runtime); **no new signing interface, KMS, issuer or token mint**. Strict invalid MAC rejection **before ANY Auth SQL**. Signed input is not allowed to claim its own verification via HTTP booleans.
- Development/staging Starry only; bounded TTL <=120s; future skew <=5s at wire validation, but inherited R004 requires \`issued_at<=now\` and therefore conservatively rejects future-issued events. Original R004 only accepts 3 event types (notification delivery, session revoked, member deleted). New \`privacy.erasure.requested\` from historic AI-0 R005 is NOT in inherited R004 supported types and is DENIED pending a separate Auth/Legal Gate.
- Verify event before calling inherited REAL (unmodified) AI-1 R004 current SessionFence and R003 signed WebCrypto Session + CURRENT SQLite Member/Session/provider; require event_id/actor_ref/brand/app/env/session_version/auth_version/issuer lease consistency across TWO independent source and Auth reads. Current \`readSessionEpoch\` is only a **test-only injected port**; schema 001 has no physical monotonic session_version migration. No real Auth D1 changes.
- Bounded per-instance Set for event_id, idempotency_key, nonce claims only after crypto confirmation prevents invalid MAC poisoning; not a durable cross-process replay ledger, no authoritative CAS/outbox/anti-PITR proof. Even a cryptographically correct synthetic signed event and an active Auth session never provide Queue ACK or send permissions. Late revoke after final read remains an unclosed transaction boundary.
- All public responses contain only version, status/reason, permanent FALSE action flags; private original-object single-use proof may include event refs and payload digest only in server memory. No member ID, session ID, token, signing key, private billing HMAC or PII in public DTO. All flags \`may_* = false\`, live false. Never accept \`offline_auth_fixture_only\` / Billing Q2 digest as P05 issuer.
- AI-0 must ratify exact real canonical signer, KMS and issuer/key rotation, legal Q104/Q119 retention, #87 D1 A/B, monotonic SessionEpoch physical storage/CAS, AI-3 durable receipt/independent anti-PITR witness and confirmed commit-before-Queue ACK, AI-4 protected route error mapping; real official Store/RevenueCat/EAS also separate.

**Release:** Gate1 PARTIAL/BLOCKED, Gate2 R005 offline only on #214, Gate3 G00–G10 11/11 BLOCKED/P05 false. External Cloudflare build for #214 was separately \`completed/failure\` with cause not confirmed, not remediated by this branch. Q4=A Google AdMob selected but Ads OFF; Battery forever free. No main merge, Cloudflare, real DB/Queue/Store/EAS/AdMob, paid resources, H-Global, consumer Monorepo or central Expo54 upgrade. **Rollback:** close R006 Draft; discard only three new AI-1 paths, preserve #214 and all owner R005 original blobs.

## R006 late source-conformance review after AI-0 independent Draft #219

Cross-checked the **actual** AI-0 immutable canonical implementation
\`packages/integration/src/ai0-r006-p05-canonical-proposal.ts\` at
[AI-0 Draft #219](https://github.com/starry-phd/id/pull/219),
source Git Blob \`faa1389b5ef4cb850b13669c1ef3f55044ac3e1e\`,
HEAD \`64f949e4d40277d964f9d4a8c4d33cc442df2c32\`.
The original AI-1 R006 adapter already matches all 17 ordered fields, wrapper, literal HMAC domain, signing bytes, KID/epoch, TTL and default OFF; it intentionally remains separate from the issuer and from AI-3 receipt CAS.
Only **AI-1-owned parser boundary corrections** were necessary: event/actor/idempotency IDs now accept AI-0's exact 8–128 character limit (instead of 8–120); trusted App scope is limited to AI-0's 3–100 characters (instead of 3–120), and issued_at must be positive (not zero). Two new real signed Auth/SQLite and negative tests protect these bounds. The R004 current Auth fence still conservatively blocks future-issued (up to +5s) candidates and the extra privacy-erasure event, even when AI-0's crypto syntax verifier accepts them. This is an explicitly **safe narrower Auth policy**, not an incompatible HMAC/wire dialect or an implicit privacy/legal decision.

[AI-0 RCA on Draft #219](https://github.com/starry-phd/id/blob/64f949e4d40277d964f9d4a8c4d33cc442df2c32/docs/operations/AI0-R006-CLOUDFLARE-EXTERNAL-BUILD-RCA-20261028.md)
confirms R005 #214 AND independent AI-0 R006 #219 external Cloudflare Workers Builds
failed because a root-invoked \`npx wrangler preview\` does not have a
\`previews\` configuration block; the actual root vs \`apps/api/wrangler.toml\`
path and isolated preview bindings need Owner approval. Neither this AI-1
contract alignment nor its successful offline CI authorizes Cloudflare
configuration/trigger changes, preview, deployment, secrets, costs, or live
P05/Queue.
