# AI-4 R14｜已提交 Task 與 Outbox 原子寫入／SQLite Crash Fence（OFFLINE）

**基線**：AI-0 R13 VERIFIED [整合 PR #100](https://github.com/starry-phd/id/pull/100) HEAD `dc798cacea55cc376ed993876c0971035353d688`，總指揮 [Issue #1](https://github.com/starry-phd/id/issues/1)、Owner [#5](https://github.com/starry-phd/id/issues/5)、[#97 Trust Root registry](https://github.com/starry-phd/id/pull/97)、[#87 Cross-D1 ADR](https://github.com/starry-phd/id/pull/87) 和 [#70 Git Tree SOP](https://github.com/starry-phd/id/pull/70)。R13 已有 Task+Head 雙 RSA 真驗簽/R11 Task→Battery ACK，AI-1 亦完成 R13 單 Auth DB delete CAS；此輪**不複製**上述成果。

新增 **Task 自己同一 DB 的交易可靠性**：`apps/api/src/round14-task-transactional-outbox.ts` 以嚴格 Starry-only 原始 committed Task 14-field DTO 及唯一 event ref，要求 Task transaction port 的 `commitTaskAndOutbox` 返回成功/同一任務冪等結算後，兩次讀回**同一個 Task DB** 已提交的 Task＋對應唯一 Outbox，所有 Task/member/price/policy/rate/result/proofRevision/eventRef 一致才有 `recorded_offline/unchanged_offline` 結果；**固定 `ack_safe=false, wallet_grant_allowed=false, live=false`**。不能靠 mock `committed:true` 對 Queue ACK，所有畸形/資料不一致/異常 fail-close。

`apps/api/contracts/task-commit-outbox.v0.DRAFT.sql` 只供 disposable SQLite :memory: 測試，記錄 accepted→succeeded/failed CAS、唯一 eventRef／taskRef、immutable final Task/outbox、append outbox 必須引用完整相符的 Task 版本。**真正 Node `node:sqlite` 本地記憶體**在 `apps/api/test/round14-task-durable-outbox.test.mjs` 用 BEGIN IMMEDIATE、prepared statement CAS 及 UNIQUE insert 結合為**單一 Task DB 事務**，驗實際 crash after Task UPDATE / after Outbox INSERT 都 rollback、重送冪等、重送變價/結果拒絕、跨任務 eventRef collision 全部回滾、immutable triggers、讀回異常、不同範圍/Proxy 拒絕。這是直接 SQL 交易，不是單純 fake D1 回答。

**嚴格保留**：沒有真正 Task 執行器與已審核 signer/KMS、真 Cloudflare D1 migration / queue publisher / trusted auth/session / Q119 依法個資、跨 AI-1 Auth DB 和 AI-3 Wallet DB 原子性、外部非回退 Head 或實體備份。產品出價／任務完成與簽章是 server-only **未取得正式信任的注入來源**。正式的 claim+Battery gift / Task+Wallet reconciliation 仍需 AI-0 選擇 #87 Starry 單交易權威或可恢復 Outbox/Saga；即使本輪 sqlite 單 DB 過關，**R11 Queue 仍不可 ACK**。不接公開 Worker/SDK、真 D1/R2/Queue/Secrets/Store/OAuth/EAS 或付費。

正式 G00～G10 **11/11 BLOCKED**、P05 PUBLISHABLE=false、`TASK_DURABLE_OUTBOX_LIVE=false`；沒有 main merge/Preview/Staging/Production/H-Global 工作。
