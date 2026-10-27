# AI-2 R18｜Billing 本地退款收件／刪帳與 PITR fail-closed Gate（OFFLINE）

## Source and ownership
- Base is **exact AI-0 R17 integrated Draft #123**, SHA `f84eab58e20377b5bd1ce313b969befb531b4938`; 3/3 same-checkout Actions success. This contains all R16/R17 owner changes. DO NOT reimport #119.
- R18 assignments from AI-0 Draft #124 SHA `ca5fc5185eae5f864b806b55b0b1ef6daee1f420`, `docs/operations/r18-cross-d1-assignments.v0.json`, Issues #1/#3. #70 one Git Tree SOP and cross D1 undecided ADR #87.
- Only 3 new `packages/rebuild-billing/**` files; no Auth, Battery, Task/Worker or shared CI mutation. R18 is an independent owner Draft based on #123, not #124 integration.

## Executable facts
- New `src/r18-refund-inbox.ts` validates **real offline ephemeral RS256 cryptographic signature** over a strict Starry development/staging store refund envelope. The pinned key is test-only; official Apple/Google source must independently be proven by a **currently injected OFFLINE mock port**. Absent signature, approved lawful origin/requery and Q104/Q119 authority, all fail closed; a caller Boolean cannot make an official authority.
- Reuses existing **R17** `reviewDeletedMember` port with actual R16 inbox/R14 tombstone/active rights SQL, current deleted Auth and simulated separate external floor twice. Checks Store committed source before writing. A single Billing SQLite INSERT with embedded AFTER INSERT trigger stores one local refund inbox, monotonic transaction refund floor and revokes still-active entitlement candidates. Strict unique keys/rollback deny duplicate source/event and stale/out-of-order refund; PAID/RENEWED never accepted to regrant.
- 17 Node22 tests use three independent `:memory:` SQLite DBs (Auth, Billing, pretend external floor), genuine R14+R16 SQL and R18 embedded table/trigger. Exercises duplicate, same source different event, newer chargeback then late refund, post-deletion regrant, Auth-only partial commit, missing Billing inbox, PITR to older active-rights snapshot, absent external floor, lawful-key deficiency, forged signed event/brand, missing Store authority, changing source, outer transaction rollback and local immutability.
- No new physical .sql migrations; original 38 DRAFT SQL inventory stays unchanged. **Local table/trigger simulation is NOT a validated Cloudflare D1 migration, and a same-connection read is NOT true durable cross-D1 receipt.**

## Formal candidate receipt/provenance contract still missing
An eventual signed Billing receipt needs legal Q104/Q119 retention; immutable Starry app/environment/merchant/store identity; event/source unique ID, canonical P05 version and bytes, official Apple/Google refund/chargeback verification and revocation ordering, independently secured issuer/key rotation (KMS), Auth deletion current version, receipt digest and replay-resistant signed floor outside Billing PITR domain, cross-D1 Saga/ACK-after-durable-commit / compensation, D1/Queue/DLQ real tests, multi-key revocation and audit. No such live authority is claimed or configured.

## Absolute Gates
All code remains OFF by default. Every output: `may_ack_queue=false,may_regrant=false,may_restore=false,live=false`, including local `recorded_offline`. Architecture A/B in #87, sole live P05 issuer, official Store and independent nonrollback anchor remain **UNAPPROVED**. G00–G10 **11/11 BLOCKED**; `PUBLISHABLE=false`; P01–P10 not accepted as live. Battery permanently free; H-Global paused. No merge main, Preview/Staging/Production, actual D1/R2/Queue/Secrets, Store/OAuth/EAS, purchases or fees.

## AI-0 next
Review exact owner-only PR files and fixed SHA specialist/full GitHub CI. Independently integrate latest R18 Owner blobs on verified #123 in a NEW isolated Draft and rerun CI at its new HEAD, not by referencing PR #124 prep or owner green as the same-checkout integration.