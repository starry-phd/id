# AI-1 Wave1 R007｜P05 vNext Auth actor/session monotonic candidate review
**Source:** AI-0 Issue #1 R007 planned after manually awakened AI-1; latest completed R006 all-owner [Draft #221](https://github.com/starry-phd/id/pull/221) HEAD `5be61848f745cc17de449d773147b8a6a5b5b742`. Dedicated AI-1 [#2](https://github.com/starry-phd/id/issues/2).

## Narrow change
Two added **AI-1 only** files (review adapter + refusal tests), plus this ADR. Original R006 #221 and all 12 imported owner source blobs remain byte-for-byte unchanged; no other writers, Worker/API, migrations, CI configuration or main modified.

- Existing R006 `reviewFresh` is the prerequisite; R007 does **not** create a P05 verifier, KMS/issuer, token, MAC or protected endpoint. Caller-owned booleans never establish authority.
- An R006 **private, single-use, synthetic review-only proof** is required; before the two injected snapshots, its Starry brand/app/env, version, evidence, no-capability flags and expiry are checked. A real production scope is refused.
- An explicitly synthetic future Auth-owned interface provides two immutable (copied) reads of `actor_ref/event_id`, opaque member/session/provider bindings, `auth_version`, `session_version`, member and session state. A change, revocation, suspension, deletion, expiry or version advancement **or regression** is denied.
- A second, independent synthetic interface returns `issuer_kid/issuer_epoch/rotation_generation` before and after snapshots. Any KID/epoch/generation drift is denied. This is NOT independent KMS proof or credential custody.
- Refusal tests include actor/account/provider switch, status/revocation, session/auth version races, key rotation, absent ports, invalid source/scope/proof and no private output. **All results permanently `verified_live=false`, `may_send=false`, `may_ack_queue=false`, `may_grant=false`**, with other action flags false. A stable synthetic observation is at most `review_only`.

## Explicitly unsolved physical Gate1
No database-owned **monotonic session_version physical schema and transactional CAS**, durable actor-binding proof, canonical production issuer/KMS/key-rotation custody, distributed replay, issuer-to-actor authorization, Q104/Q119 lawful purpose/retention/erasure or #87 A/B D1 decision. Independent anti-PITR witness, receipt/outbox and commit-before-Queue ACK belong to other domain owners and are not provided here. The second read still has a TOCTOU gap and may **never** authorize send/ACK in isolation.

## CI / integration / rollback
Run AI-1 owner and AI-0 offline cross-owner tests on **this R007 head** and record actual SHA+run IDs only after completion. R006 #221 same-SHA offline Gate2 PASS does not imply R007 or live Gate success. Gate1 PARTIAL/BLOCKED; Gate3 G00–G10 11/11 BLOCKED; P05/PUBLISHABLE=false; `release_authorization.granted=false`. External Cloudflare build failure is separate, not repaired here. Ads OFF; Battery permanently FREE. No main merge, Preview/Staging/Production, real Cloudflare/D1/Queue/Store/KMS, Secrets, paid resources or H-Global.

Rollback: close R007 AI-1 Draft and remove only the 3 new AI-1 R007 paths; R006 #221 and all historic Owner Drafts remain intact.
