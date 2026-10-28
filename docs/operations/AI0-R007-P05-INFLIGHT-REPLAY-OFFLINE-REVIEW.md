# AI-0｜Wave1 R007 P05 非同步重播競態審閱（**OFFLINE ONLY**）
> Parent: [AI-0 four-owner R006 Draft #221](https://github.com/starry-phd/id/pull/221) at `5be61848f745cc17de449d773147b8a6a5b5b742`.
> Scope: AI-0 owned source and security test only. **Does not revise canonical P05 17-field/HMAC wire contract.**
> Status: isolated source candidate; CI pending; no release/deploy authorization.

## Source observation
The R006 AI-0 `createOfflineR006P05Verifier` checks `consumed.has(replayKey)` **before** the first async verification-key read, but originally adds the key only **after** both await-based key reads and WebCrypto signature verification. Two identical signed reviews entering concurrently could each pass the initial in-process check, and both return `review_only`. Existing R006 tests verified sequential replay only.

## Narrow AI-0-only defensive change
- Add a bounded per-instance `inFlight` reservation, synchronously before the first `await`.
- Reject any concurrent identical `replayKey` as `REPLAY_OR_CAPACITY_DENIED`; use consumed + inFlight for the same 128-capacity limit.
- Release `inFlight` in `finally` on *every* outcome (failed key/MAC/rotation or success); after cryptographic success, keep `consumed` for subsequent denial.
- Add 4 executable Node tests for a first key-read held while a replay races, invalid MAC slot release, failed key slot release, and all false authorization flags.
- Keep the R006 original Owner blobs immutable; no modification to AI-1 Auth, AI-2 Billing, AI-3 SQLite/Battery, AI-4 Worker/Ads or CI workflows.

## Security / truth boundary
**This is not durable anti-replay**: memory resets on Worker restart, there is no shared authority across Workers, no anti-PITR independent witness, no physical D1/CAS/outbox, no legitimate Auth issuer/KMS, no Queue commit-before-ACK. All `may_send/may_ack_queue/may_grant/may_charge/may_request_ads/live` remain false. `P05/PUBLISHABLE=false`; Gate1 PARTIAL/BLOCKED, Gate3 G00–G10 11/11 BLOCKED. Not a fix for cross-D1 or legal Q104/Q119/#87.

## CI and external-build risk
The prior R006 [#221](https://github.com/starry-phd/id/pull/221) had 3/3 GitHub offline CI PASS on a single SHA but external Cloudflare Workers Build FAIL. Creating a new Draft PR can automatically launch the external Workers Build, potentially without a confirmed zero-cost guarantee. **This R007 fix is staged as an isolated branch/commit, not promoted to a PR until safe CI/trigger routing or authorization is confirmed.** No CI PASS or Cloudflare remediation claimed for this R007 commit. Manual local or CI verification remains necessary.

## Revert
Discard this standalone AI-0 R007 branch. `#221` and its preserved R006 Owner 12 Git Blobs, all four Owner R007 working branches, main, and Cloudflare settings stay unchanged.
