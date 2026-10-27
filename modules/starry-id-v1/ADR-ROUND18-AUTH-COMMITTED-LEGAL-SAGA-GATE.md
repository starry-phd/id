# AI-1 R18｜Auth committed outbox / lawful retention / deletion-time Session guard（離線候選）

## 固定基準
- AI-0 R17 **四 Owner 同 checkout 已驗** Draft [#123](https://github.com/starry-phd/id/pull/123), SHA `f84eab58e20377b5bd1ce313b969befb531b4938`。R18 派工 [#124](https://github.com/starry-phd/id/pull/124) 與 [Issue #2](https://github.com/starry-phd/id/issues/2#issuecomment-6444289689)。#70 單 Tree/Commit SOP；#87 A/B 還未選定。
- R15 sealed Auth outbox、R16 source-owned claimed lease、R17 lease recheck **全部重用**，不重寫。唯一 Auth logical source 是原始四欄 `event_id,s_user_id,occurred_at,event_type`，不是已批准的外部 canonical P05。

## 本輪實際新增與安全差距
1. `src/round18-auth-committed-saga-preflight.ts`：預設 OFF，僅 Starry development/staging、後端注入的兩個**互相獨立**合法目的與最低資料保留決策均明確 true 才可讀 DB。讀取目前原始 outbox + Member + 一次性 Challenge/Scope + **所有 Starry App Session 的撤權時間**，驗 `revoked_at <= occurred_at`。事後才撤掉 Session ≠ 刪帳提交時已撤權。嚴格比對 Auth R15 committed `auth_version` 與原 outbox、重用 R17 目前未過期 token+attempt 二次 fence，最終再次讀取來源/政策與時間，拒絕期間變更；沒有 INSERT/UPDATE/DELETE。
2. `test/round18-auth-committed-saga-preflight.test.mjs`：Node **真 SQLite :memory:** 載入 Auth 正式 *DRAFT* 001/007/011/012/013 與 test-only R16 租約 SQL，實際驗 one-use 原子刪帳、跨 App Session、原來源、政策撤銷、race/late revoke、重播/舊租約、跨品牌/env、缺真 commit、假 DTO；獨立第二個 Sink DB 全程不寫入。
3. `test/test_round18_auth_source_timeline.py`：Python SQLite 的真 migration/trigger 與 rollback、來源不可變及刪帳時點反例。
4. 無新 schema migration、金鑰、Store/R2/Queues、API 路由，保持 AI-0 38 份歷史 SQL DRAFT 清單原狀。

## 信任與跨 Owner 契約／嚴格禁止
- 這個 review object 僅 `offline_auth_source_review_only`，只有來源事件 ID / local auth_version / attempt（依然可能是個資關聯資料）；`may_ack_queue=false,may_mark_delivered=false,may_regrant=false,may_restore=false,may_publish=false,live=false`。**不是**可跨網域傳送的簽章證明、不是可正式採用的 Publisher，亦不是外部獨立 rollback-resistant anchor。所有可能在最後一讀後發生的競態仍須真正持久協定防護。
- AI-0 決策仍缺：#87 Starry-only physical transactional Authority 或分庫 durable Saga；唯一正式 Auth signer/publisher / canonical P05 event version / authority & issuer rotation；Q104/Q119 合法用途、同意撤回與資料保留期限、最小 ID/HMAC/KMS 用法（keyed hash 仍可能屬個資）；外部 signed commit witness/獨立單調 floor/PITR；Auth R16 lease migration schema/clock；Queue durable consumer commit/ACK/DLQ 及交付去重；真 Cloudflare/Store/EAS 測試與成本上限。
- AI-4 #5 可以使用本地 **source review-only** 介面做預定的 offline Saga 拒絕測試，但不可以 mock 當正式簽章或發出 ACK。AI-2 Billing / AI-3 Battery 仍由各自 Owner 獨佔 domain write。H-Global 暫停。
- G00～G10 **11/11 BLOCKED**, P05/PUBLISHABLE=false；不 merge main／部署任何環境／真 D1/Secrets/Queue/OAuth/Store/EAS／付費。
