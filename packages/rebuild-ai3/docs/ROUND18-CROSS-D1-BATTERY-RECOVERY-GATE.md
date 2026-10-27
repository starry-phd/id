# AI-3 R18｜Battery × Task × independent floor，離線復原拒絕 Gate

**Owner:** AI-3，Issue #4；起始 Git SHA `f84eab58e20377b5bd1ce313b969befb531b4938`，已驗四組 R17 整合 Draft #123。依 Issue #4 R18 派工與 AI-0 #124、SOP #70、跨 D1 ADR #87。此文件與程式僅是**離線候選**，不批准任何正式操作。

## 真正可執行的 R18 範圍
`src/r18-cross-d1-recovery-review.ts` 是新的唯讀審核器，**不修改 R17 #118 原有驗收及交易路徑**。固定從 AI-1 原始 committed outbox 欄位讀事件，以既有 R15 SQL 查 current deleted Member、one-use challenge scope 和 revoked Sessions。要求先有明確合法目的、資料保留用途及當下正整數政策版本，再讀會員相關欄位。沿用 R16 的 **原有真實 Battery Inbox + Wallet + revoke Journal + held-Task 子查詢**；既有 SQLite migrations 0005+0010 僅供記憶體測試，沒有新增 schema/migration。

### 最小 Battery 持久收據欄位
`event_id`、`member_ref`、`event_type=account_deleted`、`occurred_at_ms`、`policy_version`、`applied=1`、`revoked=1`、`balance=0`、`wallet_version`、`journal_revision`、`kind=revoke`、`delta`、`balance_after=0`、`reason_code=ACCOUNT_DELETED` 與 `pending_holds=0`。現有 schema 的不可改寫 trigger 防止 **同一 Battery DB** 第二次變動，不是跨 D1 的法律證明。沒有存 OAuth subject、Email、Session Token 或整筆 Task 內容。

### R18 假設獨立 Task 和 floor port
- 本輪獨立 Task 投影只在**第二個 disposable SQLite** 或 Node mock 內使用 `task_ref,member_ref,environment,status`。每個 Hold 與 Task 必須一一對應，Task committed 要 Wallet Hold committed；Task cancelled 要 Wallet Hold revoked/released/expired；任何 Task pending、Task committed 但 Wallet still held/revoked、身分/環境錯配、資料表缺漏都拒絕。**不直接寫 AI-4 Task DB**。
- 所謂 floor 是**第三個 disposable SQLite** 或 mock：`event_id,member_ref,environment,occurred_at_ms,policy_version,minimum_wallet_revision,revoked,recorded_at_ms,witness_revision`。這些只是需要將來由真正**隔離、可驗證且不可隨 PITR 一同回退**之見證來源提供的最小候選欄位。它**沒有簽章、KMS、不可回退證明、法遵核准**，不能憑 JSON 宣稱是真外部信任根。
- 缺少 floor、PITR 舊快照的 Wallet revision 低於 floor、Inbox 被截、收據和政策版本不符、見證時間/範圍錯誤、Task/Wallet 部分提交或前後兩次讀取有變，均只回 `blocked` 或 `review_only`，**不執行任何資料修改**。
- 在兩輪 Auth/Publisher/Receipt/Task/floor 讀取均一致且前後法律目的和政策版本同一時，**最佳結果仍是 `review_only`**。即使所有 mock 完整，所有輸出 `may_ack_queue=false, may_restore=false, may_regrant=false, may_settle_task=false, may_release_task=false, live=false`；不證實跨 D1 原子性。

## 真實離線驗證
- Node 測試涵蓋：缺法律與政策不讀私人來源、沒有獨立 floor、PITR revision floor 超前、憑證不完整/偽裝、Task committed 而 Wallet 未 settle、兩輪政策及來源競態、跨品牌／環境、Task/Wallet 缺證或不一致，與讀取失敗。
- Python `sqlite3 :memory:` 使用**現有 AI-3 0005+0010**，以及測試臨時的 Task/floor 兩個物理上獨立 SQLite connection。測試早於刪帳的 PITR 快照、新er floor、Task 先提交、局部交易 rollback、重送 UNIQUE、Revoked Wallet trigger、安全欄位最小化。
- CI 只以本輪最新 exact SHA 的 GitHub Actions 結果為證，不引用 R17 #123 已通過 CI 來替本輪背書。

## 未決／跨組 Issue 交接
- **AI-0 #1/#87**：批准 A 單一 Authority 或 B durable Outbox/Saga、官方 P05、法律 Q104/Q119 記憶/保留、真正獨立 KMS witness、實體 D1 連線與 PITR 作業程序。
- **AI-1 #2**：Auth source 與 Session 權威／法遵版本；**AI-4 #5**：Task commit fence、Outbox Queue retry/DLQ、ACK-after-verified-commit；**AI-2 #3**：Billing/Store 標準與自身 tombstone。本文不得被任何一方當作實際批准。
- **仍禁止** main 合併、Cloudflare Preview/Staging/Production、正式 D1/R2/Queue/Secrets、Store/OAuth/EAS/費用、金流及 H-Global 開發。正式 G00–G10 **11/11 BLOCKED**，`PUBLISHABLE=false`。
