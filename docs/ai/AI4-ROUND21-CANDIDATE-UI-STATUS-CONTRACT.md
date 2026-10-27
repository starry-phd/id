# AI-4 R21｜候選 Consumer-A 十二畫面無個資 UI 狀態 Resolver（private / offline only）

> GitHub AI-0 Issue #1 R21 索引、AI-4 Issue #5 2026-10-28 指派；上游四組 R20 同版驗證 [Draft PR #143](https://github.com/starry-phd/id/pull/143) `e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb`。AI-0 [#136](https://github.com/starry-phd/id/pull/136) 的 `docs/product/starry-consumer-a-candidate.v0.json` 是原始 SPEC，不在本輪修改。AI-0 F0 [#140](https://github.com/starry-phd/id/pull/140) 尚無研究/產品核准。

## 新增實際可執行 AI-4 程式
- `apps/api/src/round21-candidate-consumer-ui-state-resolver.ts`：僅 server-local / PRIVATE / disabled-live 的 `createR21CandidateConsumerUIResolver(scope, ports).resolve(screen)`；完整 12 畫面 Screen IDs / 9 原文安全文案與 #136 的 JSON 必須 byte-text 相符。沒有公開 Worker HTTP Route / SDK / Expo consumer screen / Store / 真模型。
- 嚴格使用 Starry dev/staging，公開 `DISCOVER`、`SIGN_IN`、`HELP_APPEAL` 絕不進行任何會員/Policy/D1 查詢。受保護畫面先檢查 legal purpose、retention 與 policy 欄位，不合法時不讀 Auth/Billing/Task/Wallet。既存真 **AI-1 R20** `R20AuthBoundaryResult`、**AI-2 R20** `R20Outcome`、**AI-3 R20** `R20Decision`、**AI-4 R20** `R20OwnerReview` 作為嚴格的 **read-only** Port。不可接受額外異常欄位、true 的 `may_ack_queue` / 付款權限或 getter 偽造來源。
- 任一 `review_only` 只表示 offline mock observation；AI-1 的 account_deleted Auth source **不等於目前登入成功**，AI-2 Store refund **不等於會員付費授權**，AI-3 Task/Wallet 候選的 reserve/commit **不等於任務真正完成**，AI-4 Saga 的 local receipt **不等於 D1 commit + Queue ACK**。因此本輪永遠不輸出 `task_completed` 或 `account_deleted_success`，也不輸出錢包餘額、款項、會員、event_ref、token、OAuth Subject、來源 digest、付費 SKU。
- R21 各 Owner **尚未正式交付新專用 UI Adapter 的情況**，僅允許 `readSessionDenial`、`readTaskHint`、`readRateCandidate` 這三個 `test_only_negative_port`：只能拒絕/提示，不能藉 test mock 當正式會員登入、費率核准、付費電池或工作成果。`missing_adapter` / `source` 對下游明確標示。

## 十二畫面映射（與 AI-0 #136 同名，無正式產品批准）

| Screen | Owner 既有來源／在 R21 的處理 | UI 安全狀態 |
|---|---|---|
| `DISCOVER` | AI-0 spec-only | `preview_only`，不讀會員 |
| `SIGN_IN` | AI-1 R20 Auth 不是 live session；公開介紹 | `NOT_SIGNED_IN` |
| `HOME` | AI-1 Auth R20 deletion-only，無正式 Session | `NOT_SIGNED_IN` 或 `AUTH_REVOKED` |
| `TASK_COMPOSE` | AI-1 + AI-4 no live task input approval | `NOT_SIGNED_IN` |
| `TASK_REVIEW` | AI-3 沒有正式核准的 X/Y / 免費 Battery fee | `PRICE_UNAPPROVED` 或 Policy blocked |
| `TASK_STATUS` | AI-3 R20 / AI-4 R20，逾時/雙擊/重播/取消的 test negative hint | `TASK_UNKNOWN` / `TASK_FAILED` / `RECEIPT_MISMATCH` |
| `TASK_RESULT` | AI-3 Task+Wallet R20 / AI-2 Billing R20 / AI-4 Saga R20 | `RECEIPT_MISMATCH`；禁止 done |
| `TASK_HISTORY` | 沒有真 Session / 法律身份 | `NOT_SIGNED_IN` |
| `BATTERY_LEDGER` | AI-3 R20 Wallet 候選；免費不可買 | `RECEIPT_MISMATCH` / `POLICY_UNKNOWN`；無金額 |
| `ACCOUNT_SETTINGS` | AI-1 R20 刪帳來源非登入或合法完成 | `DELETION_PENDING` / `NOT_SIGNED_IN` |
| `DELETE_ACCOUNT` | AI-1 已封存 committed source 仍缺正式外部權威 | `DELETION_PENDING`，絕不 success |
| `HELP_APPEAL` | AI-0 spec-only 公開最小化入口 | `preview_only`，不讀個資 |

完整九狀態文字採原版：`NOT_SIGNED_IN`, `AUTH_REVOKED`, `PRICE_UNAPPROVED`, `POLICY_UNKNOWN`, `TASK_UNKNOWN`, `TASK_FAILED`, `RECEIPT_MISMATCH`, `DELETION_PENDING`, `ACCOUNT_DELETED`；最後一項只保留 *spec 文案*，本離線實作不會主動宣稱刪帳完成。

## 離線實證範圍
- `apps/api/test/round21-candidate-consumer-ui-state-resolver.test.mjs`：依真 AI-0 #136 JSON 比對 12/9 原字句；公開無 DB；法遵預先禁止；Session 撤權；未核准/假核准費率；Task timeout/duplicate/failed/unknown/receipt mismatch；PITR、Billing/Task 返還假成功、惡意 getter、跨品牌/env、雙擊、不產生帳號刪除成功/錢包餘額/付費 Battery；再以**五個獨立 disposable SQLite `:memory:` DB**（Auth 原始 001/007/011/012/013 + R16 sealed lease、Billing、Task、Battery 原本 0005+0010、Saga local journal）建立真 Owner R20 Factory 的 offline negative-path 介面。
- 每個回應的 `private_data_included=false`, `task_completed=false`, `account_deleted_success=false`, `authenticated=false`, `wallet_balance_verified=false`, `paid_entitlement_active=false`, `can_submit/charge/purchase_battery=false`, `may_ack_queue/dlq/regrant/restore/release_task/publish/live/publishable=false`。這是 **R21_AI4_CANDIDATE_UI_FAIL_CLOSED**，不是 App/會員/Store/任務真驗收。

## 真正式上線缺件（不由 AI-4 創造）
- AI-1：只有 R20 刪帳 namespace read-only，無正式簽章登入 Session／Step-up 解除／可信已刪帳完成 UI 訊號；待 R21 Auth Owner UI adapter。
- AI-2：R20 本地 Billing Store/退款/pseudo digest unapproved；缺 Apple/Google 正式 Store proof、批准權益與 Battery 永久免費禁售政策；待 R21 Billing Owner UI adapter。
- AI-3：R20 Task/Wallet source binding 是 candidate，不是安全扣額/Task done；缺核准費率、真 Task service/Wallet 獨立持久收據與 rollback-resistant Floor；待 R21 Task/Battery Owner UI adapter。
- AI-0 / #87：跨 D1 A/B 實體架構、Q104/Q119 合法留存/HMAC/KMS、P05 唯一 Publisher/受信簽章、D1/Queue ACK/DLQ、Cloudflare/Store/OIDC/EAS/真機與第一款 Consumer App/成本皆未批准。這些缺件使 UI positive/live proof 永遠 `blocked`。

**全部 Release Gates G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false。** 不合併 main、不 Preview/Staging/Production、不真 D1/R2/Queues/Secrets、Store/OIDC/EAS、不付費；H-Global 停工。原始 Git Blob SHA、最新 PR HEAD、同 SHA CI 以 GitHub PR/Issue 日誌為準。
