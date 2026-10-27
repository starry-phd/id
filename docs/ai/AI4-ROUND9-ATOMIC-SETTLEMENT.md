# AI-4 R9 | 可信 Task 結果與 Battery 原子更新契約（離線候選）

## 固定基準與未重複
- AI-0 最新已驗證整合 Draft #71 `e130bfde68ef0fa40c628a24ec0abade0611d68f`（包含 AI-1/#66、AI-2/#68、AI-3/#69、AI-4/#67 的原始 Owner 檔案）；CI/SOP Draft #70 已納入此基線。Issue #1 R8 整合確認 3/3 workflow SUCCESS，只能稱 offline validated。
- 本輪不再建立舊的 AI-4 `task-evidence.ts`、AI-3 免費 Battery、AI-1 Auth、AI-2 IAP、Q114 申訴或 CI 重複程序。只針對 R8 遺留的 Task outcome → Battery wallet **交易時序／雙重贈送／競態**。
- Q91/Q99/Q101/Q109/Q117（已批准產品方向）；Q119 合法去重、X/Y 費率/負債實際數值，以及真的跨 D1 服務交易仍 BLOCKED。

## 實作
`apps/api/src/task-atomic-settlement.ts` 使用已存在的 AI-4 `createOfflineServerTaskAuthority` + AI-3 `finishTask/expireTask` 建立 transaction-bound **離線候選引擎**。不接受客戶端 result/status、價格、Store、URL 或 token。從**同一次後端 transaction snapshot** 派生 Task state、當前 policy/rate、第一個成功任務、Wallet 和 Member active，再產生包含 `expected_wallet_revision`、`expected_task_revision`、`expected_policy_version` 的待提交提議。真正 database adapter 必須在同一 transaction 內 CAS 全部權威版本，含會員停權/刪帳 auth_version，成功才一次提交錢包＋append-only journal；任何異常全 rollback。回傳僅 `committed/unchanged/blocked`，沒有真正電池發放的 public bearer credential。

`apps/api/test/round9-atomic-task-settlement.test.mjs` 新增 8 個 Node tests（獨立 AI-4 root CI 會自動納入）：在單 writer、序列化、異常 rollback 的測試 Store 中直接調 AI3 Battery，驗真 task 成功後最多一次給 Y；重送 8 個同時只寫一次；3 分鐘邊界 release；退款(失敗任務)、偽造權威、停權／刪帳、stale rate/revision、錯版、已撤銷 Proxy fail-closed。

**誠實限制**：此 transaction port 是 mock/injected interface，不是已建立真 D1 atomic transaction，更沒有跨 AI1/AI3 D1 的全或無保證。會員 current Session、跨服務 Outbox/DLQ/replay、法定去重 Q119、官方 task provider proof issuer/唯一 first successful task，以及真多 Worker 同時提交仍是 AI-0+AI-1+AI-3 Gate；測試的 X/Y、價格數字僅 fixture，**不得公開 Task Worker route** 或把離線 `committed` 當真實權益入帳。

`apps/api/contracts/task-settlement.v0.DRAFT.json` 為版本化內部 schema，與 OpenAPI public v0.1.0 及 SDK exports 完全分離；`ATOMIC_TASK_SETTLEMENT_LIVE=false`。G00～G10 正式全 BLOCKED；禁止 main merge、Cloudflare staging/production、真 D1/R2/Queue/Secrets、Store、EAS、真付款、H-Global。
