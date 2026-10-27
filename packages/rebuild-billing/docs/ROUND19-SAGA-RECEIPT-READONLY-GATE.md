# AI-2 R19｜OFFLINE Billing READ-ONLY Saga receipt contract

Base: AI-0 R18 four-owner integrated Draft #131, SHA f006e90311b3fecedae0f7c75004c940adfacede; 3/3 same-head CI success. AI-0 Issue #1 and AI-2 Issue #3 R19 assignments, Git Tree SOP #70 and undecided Cross-D1 ADR #87. No R18 reimplementation.

## New owner-only paths
- src/r19-saga-receipt.ts: default-OFF createOfflineBillingR19ReceiptReview exposing inspect -> disabled / blocked / retry / review_only; no write operations or Store credentials.
- test/r19-saga-receipt.test.mjs: actual separate disposable Auth, Billing and fictitious floor SQLite connections; R14/R16/R18 Billing DDL/triggers reused, 19 Node negative tests.
- This document. No new .sql migration, no edits outside packages/rebuild-billing.

## AI-4 private candidate DTO
- Only local review_only yields receipt {kind:'offline_candidate_only',brand_id,environment,member_ref,app_ref,source_event_id,auth_version,refund_event_ref,refund_source_version,locally_matched:true,official_store_verified:false,independent_witness_verified:false}. Always may_ack_queue:false, may_regrant:false, may_restore:false, may_publish:false, live:false. No official signed Store provenance, legally approved source, external immutable anti-PITR witness or cross-D1 commit.
- Requires lawful processing AND retention first and again after read; Starry app/environment/Store scope, an independent Auth deleted + by-deletion-time Session revoked projection, a non-authoritative offline Store candidate and imaginary independent floor twice; true R16 deletion/tombstone/entitlement and R18 refund/floor in local Billing via SELECT-only twice. Partial success, PITR, replay, out-of-order refund, active paid rights, foreign app/brand and missing source fail closed.
- Existing R14 SQL forbids any paid Store SKU containing battery. Starry Battery permanently free; cannot convert free balance to money.

## Critical unresolved Gate
#87 A/B physical Authority/Saga choice, canonical lawful P05 signer/publisher, Q104/Q119 retention/HMAC/KMS, real verified Apple/Google Server receipt and Store ordering, independent rollback-resistant witness, Cloudflare D1/Queue DLQ ACK-after-commit, actual App/EAS and cost authorization remain unapproved. AI-4 must not use this simulated DTO to ACK or release paid rights; AI-0 should review it for independent R19 four-owner integration.
All G00-G10 11/11 BLOCKED; P05/PUBLISHABLE=false. No merge main, Preview/Staging/Production deployment, true D1/R2/Queues/Secrets/OAuth/Store/EAS, payment or fees; H-Global paused.