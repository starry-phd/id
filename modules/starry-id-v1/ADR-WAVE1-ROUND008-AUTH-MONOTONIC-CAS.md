# AI-1 Wave1 R008｜Local Auth SessionVersion monotonic CAS／replay review (OFFLINE)
**Formal work order:** [AI-0 → AI-1 #2 #6476963111](https://github.com/starry-phd/id/issues/2#issuecomment-6476963111). **Exact base:** AI-0 R008 governance [Draft #227](https://github.com/starry-phd/id/pull/227) SHA `aecdee944158b40ffbbd129ddd126136687d7652`. R007 all-owner #226 and AI-2/#228, AI-4/#229, AI-0 partial #230 are preserved, not rewritten.

## Three new AI-1 paths only
- `src/wave1-round008-auth-session-monotonic-cas.ts`: default-OFF, synthetic server-only Auth current claim, conditional CAS/local replay interface, issuer lease and epoch-floor checks. Public output remains redacted and **all LIVE / D1 / send / enqueue / ACK / billing / charge / grant / publish flags are false**, even on a successful local CAS.
- `test/wave1-round008-auth-session-monotonic-cas.test.mjs`: concrete **Node `node:sqlite` / `:memory:`** local transactional `BEGIN IMMEDIATE` + conditional `UPDATE` + unique event ledger `INSERT` + `COMMIT/ROLLBACK` fixtures. Exercises double writer, stale AuthVersion/SessionVersion, replay, token denial, wrong brand/app/env/Host, forged verified/version headers, revoke/delete before CAS, revoke after CAS, failure rollback, synthetic monotonic floor rollback, KID epoch/generation rotation and port/time failures.
- This ADR records security boundaries, actual run evidence when available, and rollback.

## Physical Gate1 not satisfied
The source **does not** issue or authenticate real JWT/bearer tokens; a synthetically injected trusted resolver supplies opaque server-only claims. Client `verified=true` / version headers are explicitly rejected. Real valid bearer signatures, session key rotation, issuer/KMS custody, production Auth CAS schema and deployment are still missing. The test's local `node:sqlite` transaction proves only local atomicity — not Cloudflare D1 distributed/external isolation, actor source authority, durable idempotency, actual independent anti-PITR witness, privileged Queue commit-before-ACK or Q104/Q119/#87 policy. The mock monotonic floor is **not** an independent witness; full database and floor rollback together remains unprotected. A post-CAS key rotation may leave a committed **local-only** row but will never authorize sending; real deployment needs one atomic authority and independent durable fencing.

## Immutable integration and rollback
Keep exactly 3 new AI-1 paths; no changed inherited R006/R007 Owner blobs, other-owner writers, AI-0 mandatory tests, migration, Worker route, Wrangler, CI/workflows, main, Cloudflare config or paid services. Request AI-0 to import only final 3 blobs into a **new R008 4/4** integration after AI-3 delivers; #230 is currently **partial 2/4**, not Gate2 all-owner PASS.

**Gate1 PARTIAL/BLOCKED; Gate3 G00–G10 11/11 BLOCKED; P05/PUBLISHABLE=false; release_authorization.granted=false.** Cloudflare Preview+production auto-builds OFF, Ads OFF, Battery forever FREE, Expo54 unchanged. No main merge, Preview/Staging/Production deploy, real D1/Queue/Store/KMS/Secrets, payment, Ads, new expenses or H-Global.

Rollback: close this AI-1 R008 Draft/branch and drop exactly the 3 new paths; AI-0 #227/#230, AI-2 #228, AI-4 #229 and R007 #226 are untouched.
