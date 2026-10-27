# AI-3 R19｜跨 Auth／Task／Battery 三庫離線收據接口、扣額與復原安全

**來源**：Issue #4 [R19 派工](https://github.com/starry-phd/id/issues/4#issuecomment-6446351677)；Issue #1 最新 [R18 同版整合基線](https://github.com/starry-phd/id/issues/1#issuecomment-6445923593)；AI-0 verified Draft #131 `f006e90311b3fecedae0f7c75004c940adfacede`；#70 Git Tree SOP、#87 跨 D1 ADR。**只在 Starry 實施 AI-3 檔案，R18 #128 保留原版未重做。**

## 實際新功能（全數離線唯讀）

- `src/r19-task-wallet-receipt-gate.ts` 提供 `createOfflineR19TaskWalletReview(...).inspect(memberRef,taskRef,now)`。分離注入 **Auth、Task、Battery 三個 SQL 唯讀端口**，使用完全固定的 SQL / 欄位白名單，判讀日誌與當前會員狀態。Node 測試隔離三個注入端口，Python 使用三個 **真實獨立 SQLite `:memory:` 連線**：Battery 保留現有 `0005_free_battery_DRAFT.sql` 的真正 Wallet/Hold/Journal 表、約束與 UNIQUE；Auth/Task 僅是**臨時測試投影**，**絕非 AI-1 或 AI-4 已批准的真實結構**。
- 法律目的、留存範圍、目前 Policy 必須在任何受保護讀取**之前**為真，最後仍有效。會員必須仍有效，且無撤權 Session；Task 必須單一 `commit_attempt=1` 且狀態 `committed`；Wallet 必須同一 task 的 `reserve` 和 `commit` 日誌都恰一筆、`hold_status=committed`、`wallet_version=commit_revision`、`balance=commit_balance_after`，不能已撤銷、過期 reserve、policy drift、資料不完整或不同 scope。
- 中途重讀 Auth，終點再重讀全部 Auth/Task/Wallet/模擬來源/floor，偵測刪帳競態、部分提交、雙重 Task、PITR 舊 Wallet、來源失聯、政策輪替。**讀後寫 snapshot 非 live 解法**。即使所有模擬資料一致，輸出也只是 `review_only`，無任何跨 D1 原子性／簽章來源／法遵聲明。

## 最小交接給 AI-4 的「不得自動操作」收據 DTO

僅 `review_only` 可有 `candidate_receipt`：
```json
{"brand_id":"starry","environment":"staging","task_ref":"task_1",
"source_event_ref":"auth_task_source_1234567890123456789","policy_version":1,
"wallet_revision":3,"task_attempt":1,
"kind":"OFFLINE_UNTRUSTED_LOCAL_RECEIPT"}
```
無 member_ref、OAuth subject、Email、原始內容、session token、SKU、付款欄位；不得將此候選 DTO 解讀成 AI-1 可信簽名、合法 KMS、外部可回退風險已排除。R19 補充 port `provenance.readCandidate(eventRef,scope)` 與 `floor.readCandidate(taskRef,scope)` **都是測試假設**，無真正獨立鑑章者、不可回退來源或官方 P05。缺任一必要來源即 `blocked`，不能以本地 bool 當成核准。

對 AI-4 #5：可於私有 *offline* transport 接收以上 **候選 DTO 形狀**，仍需透過各 Owner 真正核准 source/sink、Task 時序與非回退權威。**無任何直接 DB 寫入 API**；返回的 `may_settle`、`may_release`、`may_ack_queue`、`may_regrant`、`may_restore`、`may_sell_battery`、`live` **永遠 false**。沒有建立第二 Auth publisher，免費 Battery 永遠不能購買/販售/換成付費權益。

## 未決決策與 Gate

#87 單一 Starry 交易權威 A / 多庫 durable Saga B **尚未選定**。Q104/Q119 合法 retention/HMAC/KMS、唯一 P05 issuer、正式簽名的 Auth provenance、獨立真正不可回退 Floor、真 Cloudflare D1/Queue ACK-after-commit/PITR、Store/EAS/預算未經核准。**G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false**。本測試不接觸 main、真資料庫／Worker、Store、Secret、部署或付費服務；H-Global 暫停。
