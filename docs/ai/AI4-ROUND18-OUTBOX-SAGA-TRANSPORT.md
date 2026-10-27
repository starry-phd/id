# AI-4 R18｜Starry private cross-D1 Outbox/Saga transport candidate（OFFLINE ONLY）

**權威**：AI-0 #1、AI-4 #5 [R18 派工](https://github.com/starry-phd/id/issues/5#issuecomment-6444330946)、[R17 四 Owner 已驗整合 #123](https://github.com/starry-phd/id/pull/123) 固定 `f84eab58e20377b5bd1ce313b969befb531b4938`、[AI-0 R18 前置 #124](https://github.com/starry-phd/id/pull/124)（該 PR **不導入**本 AI-4 branch）、#70 Git Tree SOP、#87 A/B 尚待裁決的跨 D1 ADR。

## 實作
- 新增 `apps/api/src/round18-offline-outbox-saga-transport.ts`：完全私有且始終關閉的 Outbox/Saga 交付 *候選*，只接受 AI-1 出處的 opaque `eventRef`、事先由測試端持有的 RSA 簽名 witness、政策版本；**不產生 account_deleted / 不建立第二個 Publisher**。驗證簽名的 port 只含本地離線測試 key；不是官方 KMS、Auth Authority 或 P05 核准。
- 實際注入既有 R17 `reviewExistingR17`，利用已驗 R16 單一 Auth source / AI-3 Battery 的安全界線；同時從 3 個**獨立本機 `node:sqlite :memory:` 資料庫**只讀取 Battery、Billing、Task 的候選持久收據。每筆檢查品牌／環境／會員／Auth 版本／事件／政策、local inbox、no active entitlement、0 held wallet、Task 不得提前 release。**AI-4 不寫任何他組 D1、不可把假收據當可信外部來源。**
- 自己專責的第 4 個 SQLite 只存離線配送觀察 journal（embedded DDL，**不是新 D1 migration**）。`UNIQUE(environment,event)`／`UNIQUE(environment,member)`、30sec CAS lease token、2^attempt 有限 backoff、最多 3 次本地嘗試，未完成進 `review_only`（**不真的送 DLQ**）；只在 3 sink 全部候選讀回且政策與 Auth witness 雙驗證後寫 `observed_local`。局部成功後重試只核讀，不重新生成 Auth Event 或自行 grant/restore。
- 即使 `observed_local`，若 Queue ACK 遺失後再次派送，只回 `duplicate_local` 且再次讀回當前域內收據；若 PITR 丟失或來源改變變成 `review_only`，禁止假恢復。舊記錄有刪除與 terminal 回滾 triggers 防護；持久性僅模擬同一小型本地 DB，不代表實際 Cloudflare 跨多 D1 交易、真 Queue ACK after commit 或 KMS rollback-resistant witness。
- 所有結果固定 `may_ack_queue=false`, `may_dlq=false`, `may_release_task=false`, `may_regrant=false`, `may_restore=false`, `publishable=false`, `live=false`；沒有公開 Worker 路由、新 SDK、Secrets、Provider Queue/DLQ、Cloudflare 綁定或原有 Workflow 變更。

## 驗收與風險
- 新 `apps/api/test/round18-offline-outbox-saga-transport.test.mjs` 使用 Node `node:sqlite` 與 `node:crypto` 生成**只用於本次測試**的 RSA key，驗證假的簽名不能換成 Auth 同意；端到端四獨立 SQLite memory DB。覆蓋局部提交+後續補齊、Backoff、併發租約、失去 Queue ACK 的重播、DLQ 達上限只人工審閱、簽章篡改、跨品牌/環境、法律政策漂移、會員／版本改變、Task vs Battery hold、Billing 仍有 paid 權益、PITR 恢復缺陷、過期 lease、域 DB 失效、journal 無法回滾／刪除。
- 本地：`npm ci --no-audit --no-fund && npm run typecheck && npm run lint && npm test`；CI 依 #70 現有 full offline workflow，同 SHA 同 checkout 再跑 128 SSOT、四 Owner Node + SQLite memory、Expo/Workers dry-run 和 G00-G10 `--assert-blocked`，**禁止宣稱 dry-run 代表部署通過**。

## R18 外部依賴／選型門檻
- AI-0 #1/#87：A 單一 Starry physical authority vs B 有界 Durable Outbox/Saga 未批准；需審 transaction owner mapping、最小保留/法務、Queue 順序/重送/ACK-DLQ policy、成本和可驗測的 D1/Queues Sandbox。
- AI-1 #2：唯一合法 Auth committed outbox publisher + signed issuer/key lifecycle + Q104/Q119 retention／撤銷、lease 來源；目前的 test key 不是其核准身分。
- AI-2 #3：Billing signed legal inbox/Store refund/entitlement/tombstone 真 durable readback 與 PITR 狀態；目前只讀本地候選 projections。
- AI-3 #4：Battery wallet/journal/hold durable receipt、Task settlement fencing、獨立不可回退 floor（非本地 boolean）。
- 法律 Q104/Q119、合法保留／消費者個資，真正 Storage/Queue ACK、DLQ、Cloudflare/PITR/KMS/Store/EAS、總成本上限、P01–P10 都須另經 AI-0 與業主核准；不自動選擇正式 B 架構。

**正式 Release Gates** G00–G10 **11/11 BLOCKED**；P05/PUBLISHABLE=false。所有 PR 保持 Draft/Open/Unmerged，不合併 main、不 Preview/Staging/Production、不真 D1/R2/Queues/OAuth/Secrets/Store/EAS、付款／付費；H-Global 全面暫停。
