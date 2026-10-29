# AI-2 W1 ADR｜D87 A：Billing 單一交易權威、唯一寫入者、Receipt／Entitlement／P05 Outbox 原子邊界

> **狀態：W1 OWNER REVIEW CANDIDATE / NO RUNTIME / NO APPROVED PHYSICAL D1 / G04–G07 BLOCKED**
> 
> 工作令：[AI-0 → AI-2 Issue #3 W1 #6479255178](https://github.com/starry-phd/id/issues/3#issuecomment-6479255178)；本次業主已人工恢復 W1。固定來源 **[AI-0 #242](https://github.com/starry-phd/id/pull/242) HEAD `22d7ab1c127546e9e131810d58fdf7e0ccb17882`**。本 ADR 與同目錄 [接口機讀提案](./AI2-W1-D87-A-BILLING-AUTHORITY-INTERFACES.v0.json) 共同供 AI-0／AI-1／AI-3／AI-4 審查。
>
> 此文件**只提出**在已選 D87=A、D06=A 方向下的可稽核 Billing 契約差異；不是已核准的 D1 schema、任何實際 SQL migration、真 Store/RC／Queue 接線或產品政策。Starry ID 中央會員 only；H-Global／繁星回聲不屬本 W1 範圍。

## 1｜已閱讀的真實程式碼與已核准方向

| 來源（均直接由 #242 exact SHA 讀到） | 已有實際行為 | 本 W1 要補的真正缺口 |
| --- | --- | --- |
| `packages/rebuild-billing/src/wave1-billing-revenuecat-review.ts` | `createOfflineWave1BillingPolicy` 僅審 unverified RevenueCat fixture；`may_grant=false` | 尚無單一 durable Billing authority writer |
| `packages/rebuild-billing/src/wave1-r002-signed-auth-billing-bridge.ts` | `createOfflineWave1SignedBillingBridge` 真正呼叫 AI-1 signed Session + SQL identity；前後兩次 Auth 驗證，但 `live=false`、沒有 DB 寫入 | 設計 current Auth fence 與競爭撤權在交易提交時的權威邊界，不以「先讀再寫」假稱原子驗權 |
| `packages/rebuild-billing/src/wave1-r006-synthetic-store-provenance.ts` | 測試 HMAC 和 `p05_delivery_review_only`，`R006_STORE_LIVE=false` | 合成 MAC 不可替代 Store 或 D06 正式安全封套 |
| `packages/rebuild-billing/src/wave1-r007-official-provider-adapter-deny.ts` | `createOfflineR007OfficialProviderAdapterGate` 對官方來源形狀僅回 `review_only`，明確無官方驗證 | 真 Purchase/Refund 權威證據目前不存在 |
| `packages/rebuild-billing/src/wave1-r008-cross-provider-conflict-deny.ts` | `R008_RECONCILIATION_LIVE=false`，Store × RevenueCat 看似相符也不准發權 | 不把來源的 `source_version` 跨供應商比較／不將 reviewer 提升為交易驗證者 |
| `docs/adr/AI0-D87-STARRY-SINGLE-TRANSACTION-AUTHORITY-OWNER-DECISION-20261029.md` | [業主 D87=A](https://github.com/starry-phd/id/issues/1#issuecomment-6478861308)；核准「單一交易權威」*方向* | 逐域唯一 writer、交易範圍及真實 storage 尚待審查 |
| `docs/adr/AI0-D06-P05-LAYERED-EVENT-SECURITY-OWNER-DECISION-20261029.md` | [業主 D06=A](https://github.com/starry-phd/id/issues/1#issuecomment-6478960617)：事件業務核心＋獨立安全投遞封套 | Billing 同交易產生核心事件，不自行簽名、發佈或 ACK |
| `docs/contracts/FUTURE-STARRY-ADMIN-API.md §2.3` | 11 核心欄位＋條件性 `idempotency_key`，P03/P04/P06/P08 由不同 owner 驗權與稽核 | Billing 與事件核心逐欄映射、管理退款需高風險批准 |
| 原 [POST-R008 G04/G05 13項待批准矩陣](./POST-R008-G04-G05-AUTHORITY-APPROVAL-MATRIX.v1.json) | 是**歷史核准需求快照**，當時 G05-B01 尚寫 A/B 待選 | 只以本 W1 ADR **標註** D87=A 已選；**不覆寫、不重製 13 項清單** |

另已核對 AI-0 [#243](https://github.com/starry-phd/id/pull/243) 需求索引、[#244](https://github.com/starry-phd/id/pull/244) 唯讀本人 handler、[#245](https://github.com/starry-phd/id/pull/245) 獨立 client/OpenAPI/真 HMAC+SQLite 往返。#245 本人資料實際精確**五欄**：`s_user_id`、`display_name`、`directory_opt_in`、`display_name_public`、`profile_revision`。**本人資料五欄 DTO 不是 Billing 當下 Session 授權或購買證據**；AI-2 不建立第二個 profile handler，也不從其 DTO 推定可交易。

## 2｜唯一權威的可實作邏輯範圍

**唯一交易寫入者（提案）：** `BillingAuthorityWriterPort` 專屬 **AI-2** 的受保護伺服器進入點，並由 AI-0／AI-4 未來審核註冊；Client／RevenueCat SDK／管理 UI／AI-3 Queue consumer 均**不得**直接改 receipt、first-claim、entitlement 或 Billing outbox。AI-1 擁有 Auth/current Session，AI-3 擁有 P05 security/inbox/通知，AI-4 擁有共享 OpenAPI/Worker/SDK，AI-0 有發版／schema 裁決權。

**必須屬同一已核准、可證明原子的 durable transaction 邊界（候選）：**

```text
官方已驗的 provider lifecycle 事件 → AI-2 唯一 writer
  BEGIN authorized-single-transaction  ← 不指定真 D1 API/migration
    ① 來源事件唯一性 + 原始交易 lineage 的 FIRST CLAIM
    ② 來源 receipt / lifecycle event 的正式可稽核紀錄
    ③ entitlement revision 比對且條件更新（含 refund/revoke tombstone）
    ④ D06 Layer 1 P05 business event/outbox 追加
    ⑤ commit receipt/authority revision 可追溯落庫
  COMMIT → same-authority read-after-commit / 失敗以 commit_ref 查詢
  之後另外 AI-0/3/4 安全封套簽名 → 傳輸 → AI-3 durable inbox → commit-before-ACK
```

**不能做的假設：** `Auth D1`、`Billing D1`、`Audit D1` 可以跨庫同時 `BEGIN/COMMIT`；或 Cloudflare 某個 API 一定滿足上圖所有 D1 原子語義。這是**邏輯契約**，物理單庫/多表配置、D1 transaction primitive、migration/rollback、Region/資源數量仍由 AI-0 + Owner 審核並由業主逐項批准。單一交易權威不等於整個 Starry 生態系共享一個 D1，亦不授權跨品牌資料混合。

### 可審 proposed unique constraints（不提交 migration）

| 權威唯一鍵候選 | 用途與禁止的衝突 |
| --- | --- |
| `(provider, store_namespace, original_transaction_ref)` | **不可包含 member ID**：同一商店原始交易 lineage 只能 FIRST CLAIM 給一位會員；新的會員/別的 App 不能藉另一個 scoped row 重領 |
| `(provider, store_namespace, store_transaction_ref)` | 一筆經官方驗證的商店交易唯一 receipt；退款／撤銷應更新/審核該 receipt 狀態，**不能**因同一 transaction ref 重複發權 |
| `(provider, store_namespace, provider_event_ref)` | 一個商店交易可先「訂閱」、後「退款」等多個**不同**合法事件；只阻擋**同一事件 ID**重播，不能把所有退款當重複交易刪掉 |
| `(brand_id, app_id, environment, s_user_id, entitlement_key)` | 當期會員/App 的 entitlement 權威 revision CAS；不得使用 Client ID/RC flag 自行改權 |
| `(brand_id, app_id, environment, event_id)` | Billing P05 outbox event idempotency／原子寫入；跨 App/env 不互投遞 |

所有 `*_ref` 是**由未來官方伺服器驗證者輸出的抽象識別**；原始 Store ID 是否加密／雜湊、store_namespace 定義、app-to-bundle 映射與法律保存期限尚待批准。本文件不建立真 SKU，不臆測特定 app_id、store bundle/package、金額或 Production D1 表。

## 3｜可供實作審查的 ports 與前後條件

詳細 request/response 與 proposal fields 在 [machine-readable JSON](./AI2-W1-D87-A-BILLING-AUTHORITY-INTERFACES.v0.json)。此處以伺服器**權威**用例而非使用者 UI path 定義：

```ts
// Illustrative REVIEW PORTS, not executable or implemented.
interface CurrentAuthFencePort {
  readAndRevalidate(input: SignedSessionAndScope): Promise<CurrentAuthFence | Deny>;
}
interface OfficialProviderEvidencePort {
  verifyOfficialProviderEvidence(untrusted: unknown): Promise<VerifiedProviderEvidence | Deny>;
}
interface BillingAuthorityWriterPort {
  applyVerifiedPurchase(input: {
    currentAuth: CurrentAuthFence;
    evidence: VerifiedProviderEvidence;
    expectedEntitlementRevision: number;
  }): Promise<CommittedReceipt | Deny>;
  applyVerifiedProviderRevocation(input: {
    providerServerAuthority: VerifiedProviderRevocation;
    expectedEntitlementRevision: number;
  }): Promise<CommittedRevokeReceipt | Deny>;
}
interface BillingPostCommitReadPort {
  readCommittedEntitlement(input: {
    commitRef: string; currentAuth: CurrentAuthFence;
  }): Promise<AuthoritativeEntitlementSnapshot | Deny>;
}
interface P05DeliveryPort {
  deliverCommittedOutbox(ref: CommittedOutboxRef): Promise<Delivered | Retry | Quarantine>;
}
```

*上述大寫型別皆是候選 port 名稱，並非 GitHub 已有可匯入的 TypeScript types，亦非已獲准 API。正式 shared OpenAPI/SDK/Worker 由 AI-4 統一處理。*

**Purchase／Restore:** 在**授權的未來 Store** 證據完整通過、AI-1 server-side *current* Auth+Session+App/env/issuer+version fence 重新驗證、業主已核的 entitlement/SKU 對照存在、CAS expected revision 正確時，才進行同一 transaction 的 first-claim/receipt/entitlement/outbox。RC unverified status、`loggedIn`、`x-verified`、#245 本人 five-field profile、舊 signed Auth **單次快照**均不是通行證。**Auth 與 Billing 若位在不同實體資料庫，兩次重新查詢仍可能 TOCTOU；必須額外有已核准的單調 fence/鎖策略與抗 PITR witness，否則 Live blocked**。

**Refund／Revoke:** 經官方驗證的 **server-to-server provider 撤銷**，應即使會員 Session 已撤權或帳號已刪除，也能通過獨立來源授權完成**減權**。不可為處理退款要求會員重新登入，否則會讓已離線會員保留權益。必須比對不可重新綁定的原 original transaction lineage、replay ledger、revision 與 tombstone，**late active、restore/renewal 或舊 PITR 快照不能自動重新發權**。法務保留與刪除則等待 Q104/Q119 裁決。實際官方 verifier 與真的 rollback-safe tombstone 均尚無，故目前不得接入任何購買、退款或 revoke 操作。

**Race/failure cases 的強制否定結果：**

1. 兩個會員同時先領同筆 original transaction → 唯一約束僅一筆可成功，另一筆 conflict，不產生 entitlement 或 outbox。
2. 同 provider event 重送 → 回既有事件處理記錄／idempotent no-op，**不重發權、不重追加出站事件**；不同事件引用同 transaction 不得錯誤阻擋退款。
3. Receipt 已寫、CAS 失敗或 outbox 寫入失敗 → **整筆 rollback**，不產生半套 entitlement／P05。
4. 提交回覆遺失 → 以權威 `commit_ref`／來源事件唯一鍵查 committed record 判定，**不得盲目重執行 grant**。
5. 現有 entitlement revision 過期、跨 App/brand/env 或會員 Session 撤權 → purchase/restore 拒絕；官方 server-side refund/revoke 不需會員 Session，仍執行減權。
6. 過期 webhook、延遲狀態、refund 後 restore/renewal、RevenueCat 與 Store `source_version` 不同 → fail closed；**跨 provider 版本不可直接大小比較**。
7. AI-2 commit 完成但 Queue down → **outbox 保持待投遞且不得 ACK**；AI-3 durable inbox commit 確認後才 ACK；DLQ/重試與法遵期限待裁決。
8. PITR 造成曾撤權/退款之舊權益復活 → 不允許 read/grant；需要**與 DB 回滾故障域獨立**的不可退回 witness。W1 不聲稱此 witness 存在。

## 4｜D06 P05 事件核心／獨立安全封套的 Billing 對應

**Layer 1（寫入同個 Billing commit 的 business outbox）：** 逐欄沿用 ADMIN-PREP 現有 11 核心名：

| 既有 core 欄位 | Billing 候選值及權威責任 |
| --- | --- |
| `event_id` | AI-2 權威新 outbox event ID；交易內唯一 |
| `event_type` | 如 `billing.receipt_verified`、`billing.entitlement_changed`、`billing.refund_revoke` **僅是候選事件名**，正式清單待 AI-0／AI-3 審查 |
| `schema_version` | 使用 AI-0 將來核准的**業務事件核心版本**，不可沿用 R006 `version` 冒充 |
| `brand_id` / `app_id` / `environment` | 只能取可信 server scope + 既有權威登記，絕不由 client 選定其他品牌或 env |
| `occurred_at` | 獲准的 trusted authority business event time；**不等於** R006 security `issued_at` |
| `correlation_id` | 貫穿已驗證 source event、權威 commit 與 outbox；不得當 Auth principal |
| `resource_type` / `resource_id` | 最小必要、不泄露原始收據/交易 token 的權威 Billing 資源 reference |
| `result` | 審核的成功/拒絕/減權處理結果；不能把 `review_only` 當成功支付 |
| *conditional* `idempotency_key` | **付款／退款／撤權或重試**事件候選應帶，來源由經驗證 business operation identity 導出，不能信任 client 任意文字；正式各事件 required/optional 待 AI-0 核准 |

這是 11 + 條件一欄的**業務事件 core**；[G06 release 未列出的「13 欄」](https://github.com/starry-phd/id/pull/236) 仍是**未解決權威差異**，本設計沒有發明第 13 欄，也不把 R006 的 17 欄自動定版。Internal `receipt_ref`、`commit_ref`、`outbox_status` 可作同交易的私有持久化欄位，但**不能冒充 Layer 1 額外已准公開欄位**。

**Layer 2（獨立安全投遞封套）：** 由 AI-0/AI-3/AI-4 另行決定 issuer/KID、簽章／MAC、nonce/epoch、完整性 payload hash、時間、防重播、Auth/Session 有效性、版本相容、delivery retries/ACK/法務最小化。AI-2 僅暴露 **committed outbox ref + business core read port**；**沒有簽章權、不能把自製 HMAC 當 P05 的 signer，不得自動 enqueue/send/ACK**。AI-3 durable inbox 成功後 ACK；若費用／存續／法律尚未批准，整條路徑維持 DISABLED。

## 5｜契約差異（不是重建 POST-R008 13 項待批准清單）

| 舊版已交付 | 本 W1 新契約提案 | 未完成／不改動項 |
| --- | --- | --- |
| G05-B01 於當時紀錄 A/B 未決 | [D87=A 已正式批准方向](https://github.com/starry-phd/id/issues/1#issuecomment-6478861308)；唯一事務權威 + 唯一 writer ports 候選 | 既有 13 項 JSON 原件保持原始 Git Blob，不修改歷史 |
| R001–R008 review-only Auth/Store/RC 策略 | 正式 server identity與官方 provider verifier 與 writer 是**三個獨立 trust ports**，沒有 reviewer→verified 升權捷徑 | Store/RC 真實驗證／SKU、權益政策 G04 仍 BLOCKED |
| R006 17 欄 P05 HMAC offline candidate | D06 已選 11 業務核心＋條件 `idempotency_key` 與獨立安全封套，receipt/entitlement/outbox 同 commit | G06 未列舉第13欄/正式 schema/簽章全部 BLOCKED |
| 本機 SQLite race/outbox/deny tests | 明列真 Storage 所需 unique constraints、CAS、提交後讀、rollback/replay/late refund 的不變量 | **不重新執行已完成 R008 測試**，不能借 SQLite :memory: 宣稱真 D1 驗收 |
| #244/#245 signed 本人 profile reader | **五欄唯讀本人資料不連 Billing writer**；AI-2 需 AI-1 current AuthFence，AI-4 未來 protected route | 正式 Worker/SDK health-only 差異仍由 AI-4 審查 |

## 6｜AI-0／AI-1／AI-3／AI-4 待審接口與阻塞

- **AI-0 #1：** 確認哪個 *logical* transaction store 是 authoritative；是否在同一實體 DB 能涵蓋 Billing 首領、receipt、CAS、outbox；決定不能跨 DB 原子寫的 Auth session fence 協調方法。既有 D87 A 和 D06 A 方向無須重選；本 ADR 只是提案。
- **AI-1 #2：** 提出 server-only `CurrentAuthFencePort` 的**時效／可鎖定／單調撤權語義**、正確的 `s_user_id`/App/env/Session/issuer 驗證；不得把 #245 profile snapshot 當交易證明。Provider refund/revoke 允許獨立權威減權。
- **AI-3 #4：** 提出 D06 Layer 2 transport 及隔離驗簽、inbox/replay ledger、commit-before-ACK、DLQ/重送/PITR witness；**不同 refund/lifecycle events 引用同交易不等於重播**。
- **AI-4 #5：** 未來正式 shared OpenAPI/SDK/Worker 範圍、App registry identity、protected routing、伺服器授權/錯誤碼；只接受明確檢核的 Writer/Read ports，不提供任意 DB writer。不須重寫 AI-0 #245 client／handler。
- **待業主／法務／資源核准：** 原 G04/G05 已有 13 項清單保持未核准；官方 Apple/Google/RC、商品 SKU、真正 isolated D1/Queue/DLQ、Secrets、migration/費用上限、Q104/Q119 retention/legal hold、P05 G06 最終 schema/issuer、第 13 欄來源、真獨立 anti-PITR、真正 retry/rollback 正式驗收。

**Gate：Gate1 PARTIAL/BLOCKED，Gate2 僅過去 R008/POST-R008 offline PASS，Gate3 G00–G10 11/11 BLOCKED；G04/G05/G06/G07 `evidence=[]`，`P05/PUBLISHABLE=false`、`release_authorization.granted=false`。Starry Battery 永遠免費、Ads OFF、Expo54 不變。**

**回退：** 只需關閉此 W1 的獨立 AI-2 Draft 並棄置兩份新增 `packages/rebuild-billing/docs/AI2-W1-*`；#242、#243～#245、R008/POST-R008 原碼、歷史 13 清單、main 與 Cloudflare 全部保持原樣。**未經授權絕不合 main、部署/開 Preview、建真 D1/Queue/Store/RC/OIDC/Secrets/EAS、產生費用或介入 H-Global／繁星回聲。**
