# AI-4 R20｜真 R19 Owner 唯讀 Adapter 接線與跨域阻擋矩陣（離線候選）

**基準/任務：** AI-0 Issue #1 R20 派工、AI-4 Issue #5 R20 指派、已驗四位 R19 同 SHA [AI-0 Draft #137](https://github.com/starry-phd/id/pull/137) `b713cbbc44307a325fec71fff74c81defbd95c71`。跨 D1 ADR #87 的方案 A/B 尚未裁決，SOP #70 以單批 Git Tree 並在 PR 新 HEAD 實際跑離線 CI。無需重做 R18/R19。

## 實際新增
- `apps/api/src/round20-private-r19-owner-interop.ts` 以**現存的三組 R19 Owner factory 的真實 TypeScript 輸出型別與實際方法**相接：AI-1 `createOfflineAuthCrossDomainDTO(...).readForOfflineConsumer(sealedClaim,'saga',scope)`、AI-2 `createOfflineBillingR19ReceiptReview(...).inspect(request)`、AI-3 `createOfflineR19TaskWalletReview(...).inspect(member,task,nowMs)`；並在設定上接受 AI-4 既有 R19 `createR19OfflineFourDomainWire(...).inspect(eventRef,nowSec)`，但**未經身份、物理交易/法遵批准，刻意不呼叫會更新本地 Saga 的後段**。
- 在任何個資／DB 讀前需要 pinned legal-purpose + retention + policy revision；多次核驗 AI-1 真封存的獨立 Claim，拒絕 revoked Session / expired lease / policy drift；三組結果資料形狀嚴格封閉，不接受借用某個 `ack=true`、未驗 Store 候選或帶 getter 的 hostile input 作授權。
- 以 read-only `review_only`、`blocked` 作區分，**任何返回值固定** `may_ack_queue=false, may_dlq=false, may_release_task=false, may_settle_task=false, may_regrant=false, may_restore=false, may_publish=false, may_sell_battery=false, publishable=false, live=false`。
- `apps/api/test/round20-private-r19-owner-interop.test.mjs`：真 AI-1 原 schema 001/007/011/012/013 + 實體 sealed claim/lease、真正 AI-2 R19 Store/delete read-only adapter、真正 AI-3 R19 Task/Wallet gate/真 Battery 0005+0010 SQLite schema、AI-4 Saga journal；五個**完全不同** disposable SQLite `:memory:` connections（Auth/Billing/Battery/Task/Saga），驗證合法缺件、獨立 DB PartialCommit、無 Store provenance、Session 撤權反覆、跨品牌環境、錯來源/不一致輸出、無隊列 ACK。

## 不得謊稱已完成的跨域映射
- **AI-1 #2（已真正接入）：** R19 `R19OfflineSourceDTO` 保存 `account_deleted` 的四原始欄位、來源 `s_user_id`、Auth 版本/租約回合，但輸出自稱 `offline_untrusted_cross_domain_auth_projection`；不是合法核准的 P05 portable signed event、KMS 或外部證據。
- **AI-2 #3（已真正接入）：** R19 Billing receipt 要求受隱私保護的 `m_<hash>` 會員與 `r_<digest>` 權益，另有 `refund_event_ref` 與 `source_event_id`。**沒有已批准 AI-1 `s_user_id` → Billing member_ref/HMAC 的有效對應或 Apple/Google 正式退款簽章**。即使 `review_only` 仍 `official_store_verified=false, independent_witness_verified=false`；拒絕當成已完成真權益撤權。
- **AI-3 #4（已真正接入）：** R19 Task/Wallet 觀察的是**活躍會員的 task source event** + wallet reserve/commit；AI-1 的這條來源是**已刪帳會員的 account_deleted event**，兩種時序/權威**不能混為一談**。AI-3 `OFFLINE_UNTRUSTED_LOCAL_RECEIPT` 只能 read-only，假 floor/簽章仍缺。
- **AI-4（本輪）：** 原 R18/R19 Saga journal 與 ACK lost/backoff/duplicate 保持原樣、未被替代或啟用真 Queue；R20 新 Gate 在缺簽章、身份合法映射、Store 外部見證、非回退權威與跨 D1 物理決策時停在 `blocked` 或 `review_only`，因此連假穩定三 Owner 模擬輸入也不觸發 Saga mutation。這是設計上的 Fail Closed，不是未寫實作。

## 明確還缺的權威
1. `OFFICIAL_P05_SIGNED_AUTH_ISSUER_AND_LEASE`（唯一 AI-1 Auth issuer/P05 已核准來源及合法 KMS Key 生命週期）
2. `Q104_Q119_APPROVED_CROSS_DOMAIN_IDENTITY_MAPPING`（合法目的、最小可比對 HMAC、保存期限/撤回、從 Auth 到 Billing/Task 的正式映射）
3. `OFFICIAL_STORE_REFUND_AUTHORITY`（Apple/Google server receipt 退款真來源，免費 Battery 永不當商品）
4. `TRUSTED_NONROLLBACKABLE_EXTERNAL_WITNESS`（真正非回退的 floor/PITR 反復活）
5. `APPROVED_PHYSICAL_CROSS_D1_ACK_AFTER_COMMIT`（AI-0 #87 A/B 選型、D1 真實 topology、Queue/DLQ ACK-after-owner-durable-commit 安全規範）

**Release G00–G10 11/11 BLOCKED, P05/PUBLISHABLE=false。** 無第二個 Auth publisher、無對外 Worker route、無真 D1/R2/Queues、Store/OIDC/Secrets/EAS、無 domain DB 寫入、無主線合併與部署、無付費。H-Global 暫停。
