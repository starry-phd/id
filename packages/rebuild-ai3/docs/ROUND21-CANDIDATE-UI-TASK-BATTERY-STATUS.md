# AI-3 R21｜Free Battery × AI Task 候選 App 的唯讀 UI 狀態契約

**工作來源**：[AI-0 R21 指派](https://github.com/starry-phd/id/issues/1#issuecomment-6448253032)、[AI-3 R21 Owner](https://github.com/starry-phd/id/issues/4#issuecomment-6448279950)、[AI-0 R20 已驗同版 Draft #143](https://github.com/starry-phd/id/pull/143) `e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb`，另讀 #70 SOP、#87 ADR。對照 AI-0 [#136 候選消費 App UX](https://github.com/starry-phd/id/pull/136) 的 `TASK_REVIEW`, `TASK_STATUS`, `TASK_RESULT`, `BATTERY_LEDGER` 與 9 項候選失敗文案。#136 僅產品紙面規格；#140 F0 未實際執行；**正式首款 App 尚未選定**。

## 新的可執行 TypeScript 私有唯讀 port

`createOfflineR21CandidateTaskBatteryStatus({enabled,scope,authDb,taskDb,batteryDb,mapping,lawfulPurposeNow,lawfulRetentionNow,approvedPolicyVersionNow,approvedFreeBatteryRateNow}).project(memberRef,taskRef,screen,serverNowMs)`。

- 版本 `starry.candidate.task-battery-status.v1`；僅 Starry `development/staging`、預設 OFF。後端內部輸入可包含 member/task，但 **DTO 輸出只有** `schema_version,kind,screen,state,message_key,balance_display,rate_display,task_completed,wallet_settled,status_authoritative,can_submit,can_retry,may_settle,may_release,may_regrant,may_restore,may_ack_queue,may_sell_battery,live`。**絕不包含**會員/任務/事件 ID、Email/OAuth Subject、Wallet 原數字、X/Y、費率、Store SKU、付款或可重放 Token。
- 顯示狀態的封閉集合：`rate_not_approved`, `balance_unverified`, `hold_pending`, `task_unknown`, `task_failed`, `receipt_mismatch`, `blocked`, `review_only`, `unconfirmed_balance`。它們只表示無法確認或內部審閱，**沒有 `completed`、`paid`、`spendable`、`purchase`**。 `message_key` 是固定 key，不接受資料庫錯誤/會員輸入文字，AI-4 可依 AI-0 候選 UX 文案表做 local mock 翻譯。
- 法遵用途與最短合法保留、當前 policy 必須在任何敏感讀取之前滿足，費率未獲批准即顯示 `rate_not_approved`，不展示假數字。使用 R19 **原有唯讀 SQL** 查 Auth、Task、Battery 原 Wallet/Hold/Journal；Task 已 `committed` 但 Wallet 尚保留中／commit 日誌缺漏／PITR 舊版，顯示 `receipt_mismatch`，**不能顯示任務成功或結算完成**。Task pending + held 顯示 `hold_pending` 且禁止重送；Task 不明顯示 `task_unknown`、缺 Wallet 顯示 `balance_unverified`，刪帳/Session revoked/跨會員或環境/法遵未知顯示 `blocked`。
- 僅在先前 Wallet/Task 本地 SQL 一致時，才呼叫 **既有 R20 `createOfflineR20TaskWalletBinding().inspect()`** 注入的 `mapping`，驗證仍 `review_only`、所有權限 false、版本/任務/來源映射與原 wallet revision 精確一致；再重讀 Auth/Task/Wallet 與合法 policy/費率。R20 的 Task Publisher 和 signed floor **仍然只是候選／未核准**。即使 mock 同版一致，結果至多 `review_only` 或電池明細 `unconfirmed_balance`。
- **全部輸出** `balance_display=null`, `rate_display=null`, `task_completed=false`, `wallet_settled=false`, `status_authoritative=false`, `can_submit=false`, `can_retry=false`, `may_settle=false`, `may_release=false`, `may_regrant=false`, `may_restore=false`, `may_ack_queue=false`, `may_sell_battery=false`, `live=false`。

## 可實際執行的驗證

- Node：直接測 R21 TypeScript 函式並固定校驗 R19 原 SQL 和 R20 DTO 欄位（含 4 screen/所有狀態、無個資輸出、雙擊 reserve、Task 成功但 Wallet 未 commit、Policy／法遵變更、未核費率、Session 撤權、舊 Wallet/PITR、無 floor、跨會員/env、fail-closed 不顯示正向完成）。
- SQLite：三個物理**獨立** `:memory:` DB connection——Auth/Task 是離線暫時投影，Battery 使用既有真實 `0005_free_battery_DRAFT.sql`/Wallet/Hold/Journal 真約束。直接演練兩庫部分提交、重放、撤權、保留中、來源錯位、PITR 舊快照。**它們不是三筆 Cloudflare D1 真跨庫原子交易，也不證明真正客戶端 UI 已開發。**

## AI-4 Issue #5 明確交接

AI-4 可由 **PRIVATE local mock** 採用 `R21CandidateUiDTO`，將 `state + message_key` 對照 AI-0 #136 規劃 UX；沒有已認證 Owner R19/R20 端口／合法核可就顯示 `blocked`。此 DTO **不得作 API Endpoint、客戶端真權益證明或正式 Store 顯示**；不增加 Expo route、不改正式 Bundle ID、不碰任何 AI-4 owned file。嚴禁因本地 `review_only`、`unconfirmed_balance` 顯示「任務成功」「可用電池已結算」。

## 仍未解除的上線阻塞

#87 A/B 物理跨 D1 架構、唯一真 P05 Publisher／法定來源／Q104/Q119 Retention/HMAC/KMS、外部不可回退 floor、真 Queue ACK/DLQ/Store/OIDC/EAS、產品身份、定價與費用均未核准。**G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false；免費 Battery 永久免費、不可買賣/兌付。** 只做離線測試：不合併 main、不部署 Preview/Staging/Production、不真 D1/R2/Queue/Secrets/Store/EAS、不付費，H-Global 暫停。
