# AI-3 第五輪｜AI-2 Billing D1 → AI-3 Audit D1／Queue／人工復原 Gate

**狀態：離線可執行整合候選，非真實 Cloudflare D1/Queues。** 基準為 AI-0 第四輪整合 [Draft #46](https://github.com/starry-phd/id/pull/46) `bacc0166bf4e1070a4696c7bc109197b4c642f9f`；AI-0 最新 [Issue #4](https://github.com/starry-phd/id/issues/4) 第五輪已確認任務；不更動 AI-0/AI-1/AI-2/AI-4 檔案。

## 新增真正跨 Owner 離線驗證
- `integration/round5-billing-committed.test.mjs` **直接引用**同一 checkout 的 `createSandboxBillingD1Writer`（AI-2 #44）、`planSandboxPurchase`（AI-2）、`createServerIdentityResolver`（AI-1 sealed test principal）、AI-0 `isCandidate`（#43，`PUBLISHABLE=false`）、AI-3 `createRound4BillingAuditConsumer`、`createAi3AuditD1Store`、`dispatchQueueMessage`。所有 DB/Store/Principal 連接均以 deterministic mock + test-only WebCrypto key，**不是實際 Provider 驗簽或真正 D1**。無真金流。
- 失敗場景：AI-2 atomic commit 失敗、已提交來源尚未可見（`readAfterCommit=null`）／無法訪問、已提交後多次 redelivery、Digest 同 key 不同 payload、AI-2 後端來源時序告知 superseded、AI-3 D1 batch 中斷與 rollback、quarantine 寫入失敗、DLQ 寫入失敗/成功先後。僅當 AI-3 持久化稽核或隔離、或 DLQ 確實持久化後，才能 Queue ACK。**AI-3 無權變更 Billing entitlement**。
- 第五輪修正：未提交/尚未出現的 Billing row 為「來源暫時缺失」，不等同驗證失敗；在可用 ACK 前一律 bounded retry/再經人工 DLQ，不應提前 quarantine+ACK。來源驗證/權限實際尚未具備，不能把 Queue body 的 `verified_provider/committed` 布林當可信。
- 版本界線：AI-0 唯一 canonical 13 欄 `billing.p05.v1-candidate`（交通格式、**PUBLISHABLE=false**），AI-3 `rebuild-ai3.0.1-candidate`（內部稽核儲存格式）。即使傳輸形狀吻合，AI-2 **真實經認證的已提交交易**、AI-0 allowlist、AI-3 原子持久化是三道不同 Gate。禁止自動啟用未核准的退款、額度、付費 Battery 功能。

## 真實 D1/Queues 授權前必備事項（僅計畫）
1. **資料權威與隔離**：Starry-only、不連 H-Global；AI-2 Billing D1 為權益/Store 唯一寫者，AI-3 Audit D1 為 inbox/quarantine/audit 唯一寫者，AI-4 的 Queue Worker 只可用 scoped 短期授權讀 AI-2 verified committed row 並要求 AI-0 可信 P05 版本；不能讓 HTTP 身分冒充後端事件。
2. **實體 migration**：先核准現行 schema/版本/索引/保留與個資刪除政策，擬定 D1 專用 db_id/環境對映和 migration 唯一單寫者；離線 SQLite 測完後經另外批准才對 **獨立測試 D1** 演練，**現在禁止執行 remote migrate/execute/drop**。
3. **備份/rollback/清理**：遷移前列 D1 schema hash、commit SHA、備份還原點與匯出驗證。失敗時封鎖 Queue 消費、維護未 ACK 訊息並記下相依 outbox；由 AI-0 核准 restore/forward-fix，不能清掉已 ACK 記錄、使用未授權 DELETE、把 append-only 與合法 Erasure 要求相互矛盾。保留 audit 的去識別/到期策略待人工法律和需求審核。
4. **最小授權與 Queue**：兩個 D1 分域、Queue producer/consumer 專用權限與 Secrets、環境限 staging/development，DLQ 的持久化回執不可用 HTTP bool；AI-4 和 AI-0 核准 `max_retries` / 超時 / delayed retry / Queue dead-letter 最終失敗機制，測試批次獨立 ACK、重送、容錯、Queue 熱點與警報，不承諾跨 DB exactly-once。
5. **人工 replay（尚未核准業務）**：只提出 `review_only` 草稿及測試，不觸發事件重播；需 AI-1 現行 session/step-up/實際 scope、事件可重放類別白名單、事件審核原因/提案人/批准人、去重鍵保留、原始事件重新回查與 DLQ 不可編修證據、具體追蹤/回復權限。退款/停權/刪帳不得以稽核事件重新賦權或付款。
6. **DEV-I Expo/EAS 免費成本**：保持每 PR strict TS/Node/SQLite 安全 CI；不自動 EAS Build/Update/Workflows，不自動改 Cloudflare 或付費方案。須原生登入/IAP/通知驗證時，另經業主核准執行必要真機與 Sandbox 測試；費用估算與實際帳單分開。

## 邊界
本 PR 完全不改 main、不合併、不部署、不運行正式或測試 D1/Queues/Cloudflare、不改 Secrets、不發真實 Apple/Google 付款事件、不觸發 EAS Build。AI-0 Gate0 SSOT（25 seed/128來源）與 Gate1 真實資源都仍 BLOCKED。
