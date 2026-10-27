# AI-4 R17｜Starry 刪帳事件多 Sink 離線收據審查（DRAFT / RELEASE BLOCKED）

**權威來源**：AI-0 Issue #1；AI-4 Issue #5；AI-4 R16 Draft PR #116 固定 SHA `2729b23a8237da80680d652a81c0572ca1363176`；上游已驗四 Owner 同 SHA AI-0 R15 Draft #112 `e9b4a9e244342bfc2725b1daafca21dbb35ff8ad`；單 Tree SOP #70，跨 D1 ADR #87。R16 四 Owner 尚未正式跨組整合，不能將 Owner CI 視為新的四組 Gate。

## 實作與唯一權限
- `apps/api/src/round17-offline-deletion-fanout-review.ts` 僅為 **offline test-only** readback guard：先檢查本地未核准政策投影、Auth 當前已刪除投影，才交由既有 R16 `deliverLocal(eventRef,nowSec)` 執行原有 AI-1 sealed Source→AI-3 Battery 本地測試，事後重讀候選三個 sink 收據與當前 Auth/政策。
- `battery / billing / task` receipt 皆是 **未核准、測試用投影**（同一 opaque event、Starry/環境/會員/版本/政策、一致本地 inbox／禁止重授／無待處理作業）；目前並無正式統一 DTO、真 Billing/Task API、真 D1 或合法 issuer。絕不把 Mock 當官方 durable authority。
- 法律政策在本地 delivery 後或 readback 後改變，僅回 `retry`；若 Battery 本地已提交，**不宣稱能回滾**。R16 source 如變化也不能據此宣稱跨庫 exactly-once。
- 僅 `blocked`、`retry`、`candidate_consistent` 三種本地審查結果；即使所有候選收據符合，**永遠** `may_ack_queue=false / may_dlq=false / may_regrant=false / may_release_task=false / publishable=false / live=false`。
- 既有 R16 SQLite/AI-3 寫入權限與唯一 AI-1 Auth logical publisher 保持不變；AI-4 沒有第二 publisher、沒有 Queue endpoint、沒有新的 D1 migration、沒有更新 GitHub workflow 或 H-Global 資源。

## 可重現離線測試
- 根目錄 `npm ci --no-audit --no-fund`、`npm run typecheck`、`npm run lint`、`npm test`；全量另跑既有 `.github/workflows/ai0-current-offline-gate.yml`（同一 PR HEAD），不用額外 Actions 工作流。
- 11 個 R17 Node 單元/負測：三 sink 一致候選、任何缺收據、跨品牌環境、政策變更在 R16 本地寫後、過期版本/會員、偽造 publisher/ACK、來源漂移、惡意 getter/不可用 sink、重複審查；R16 原三個獨立 SQLite :memory: DB 真 source+sink 測試原樣保留。

## Release Gate 與跨 AI 依賴
- AI-0：#87 尚未選單一物理交易權威／Durable Outbox Saga；G00–G10 11/11 BLOCKED，P05 PUBLISHABLE=false；先整合 R16 #113/#117/#115/#116 和 R16 AI-0 #114，再融合 R17 owner 差異，以新整合 SHA 重新執行全量 CI。
- AI-1：唯一正式 Auth Publisher 及合法 Q104/Q119、canonical signed version/retention、獨立不可回退證據仍待裁決；R17 #120 為獨立 Owner Draft。
- AI-2：R16 #117、R17 #119 的 Billing signed proof/本地 tombstone 僅 Owner 候選；此處的 Billing receipt 不是接上其 DB。
- AI-3：R16 #115、R17 #118 提供各自 Battery 持久收據/法律政策 Gate；此處 Battery receipt 只做上層交付缺件偵測，不寫 Wallet。
- AI-4 後續真 Queue/DLQ/ACK/持久 fanout、Task fence 接線需 AI-0 決議、真實提供者授權與合法成本 Gate；不得以本次一致性候選解除。

**安全不變**：不合併 main、不 Preview/Staging/Production、不真 D1/R2/Queue/Secrets/OAuth/Store/EAS、不付款／不花費、不 H-Global 工程。ADMIN-PREP P01/P02/P05/P06/P07/P08/P09/P10 僅供未來契約驗收，沒有因此驗證正式監控、費用或發佈。
