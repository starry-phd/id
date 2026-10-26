# AI-2｜Starry 數位 Billing／IAP Sandbox 契約 v0.1
**DRAFT · NOT DEPLOYED · NOT STORE VERIFIED.** Owner: AI-2, Issue #3. Gate: #1, ADMIN-PREP: #13.
API paths in STARRY-BILLING-OPENAPI-draft.yaml are proposals, NOT deployed endpoints.

## 1. 範圍／權限／產品
- **僅 Starry** 數位商品／Apple IAP／Google Play Billing、月年訂閱／非消耗型一次性權益、沙盒通知／退款／撤銷模型。**H-Global、PAYUNi、實體票券、Production、真實扣款、真實 D1 與免費 Battery 收費永久不包含。**
- AI-2 是未來 Starry Billing D1 的唯一寫入領域；AI-1 持有 Starry s_user_id、JWT/Session、撤權、Admin/Step-up；AI-4 持有 OpenAPI、Workers/Expo 工程基座與 App Registry；AI-3 持有共用事件稽核規格。沒有跨品牌付款權益／共用 DB。
- 範例 `starry.demo`、`phd.starry.demo`、`test.monthly` 全是假資料；尚未批准真實 SKU／Bundle ID／Package name／定價／地區／單次商品是否可消耗、寬限期與跨同系 App 權益。免費 Battery 永遠不能變成購買商品。
- 維持後端驗證、最小權限、品牌/App/環境隔離，未批准事項預設拒絕。

## 2. 正式驗證流程（**待實作**）
1. 客戶端提供 **不可信** 原生購買憑證或 token，不提供可採信的「已付款」旗標；購買結果不得由裝置直接發權。驗證用的 s_user_id 只能從 AI-1 server session 得來。
2. Apple 未來使用 App Store Server API、signed transaction JWS／憑證鏈及 App Store Server Notifications V2 signedPayload 官方驗證；比對 Bundle ID、appAppleId（適用時）、store environment、transaction/originalTransaction IDs、product ID、owner binding、expiration／revocation。**不可只解碼而不驗簽**。
3. Google 未來使用 Google Play Developer API（訂閱 purchases.subscriptionsv2.get／適用的一次性產品查詢），比對 purchase token、package、product/base plan、purchase state、expiry、linked purchase、acknowledgment、購買者綁定。RTDN/Pub/Sub transport/OIDC 身分需獨立驗證；收到通知後 **重新向 Google 查權威狀態**。RTDN 不能直接發權。
4. 首次購買以 server-generated account binding 對上 **store-verified** account reference；續訂/退款以原始 transaction → immutable s_user_id 對應。不同帳號復原、缺綁定、來源不明一律 quarantine/manual review，不得移轉權益。
5. 由 server registry 比對 `brand_id=starry`、`store_environment=sandbox`、app_id、SKU、Apple Bundle/Google Package、store；Production、別的品牌、錯誤 SKU 必須拒絕。
6. 先完成外部 Apple/Google 驗證，再以 Starry-only D1 **原子寫入**唯一 `(store,environment,store_app_id,store_transaction_id)` 與 `(store,environment,provider_event_id)`，比對 digest、防重放、版本 CAS、事件/outbox。不得跨外部 HTTP 持有交易；重複同內容不重複發權，同 ID 不同內容拒絕／隔離。
7. 續訂與退款可能逆序；須依原始交易群組、每期 transaction 及可信有效時間重新計算投影，舊期間事件不得覆寫新有效續約。GRACE_PERIOD、ON_HOLD、EXPIRED、REFUNDED、REVOKED 預設停權（寬限期業務政策待決）。免費 Battery 不受任何 Billing 事件影響。
8. 權益每次使用仍須重查 Auth／停權與 app scope；不允許舊 session、UI 按鈕或快取自行恢復權益。禁記 raw store tokens／JWS／secrets／卡號／不必要個資。

**程式安全界線**：`packages/billing-contracts/src/index.ts` 是「已由可信 server adapter 驗證之證據」的 **純狀態測試 reducer**，不是 Apple/Google 簽章驗證器。 `verifiedBy` 字串若由 HTTP client 自填可偽造，**絕不可直接讓 client 呼叫 reducer**。`previouslyProcessedEventId` 也只模擬 DB 唯一性決定，不能取代 D1 原子冪等。未接真實商店、D1 或 Workers。

## 3. 資料模型／API 草案
- `packages/billing-contracts/schema/0001_draft.sql`：Sandbox **尚未執行** 的 Starry-only D1 tables：billing_products、billing_transactions、billing_events、billing_entitlements、billing_refund_reviews、billing_audit；正式 migration、保留期限、outbox/quarantine 待核准。
- 草案 `POST /v1/billing/purchases/verify`（Starry member）、`GET /v1/billing/entitlements`（`billing:entitlements:read:self`）以及 `POST /v1/admin/billing/refund-reviews`（`billing:refund:review`，限 Starry sandbox、特定 App、附原因／核准 ID、五分鐘內 step-up）；**管理操作僅作審核/對帳，絕不真退款**。
- Apple/Google webhook paths、實際 store adapter／金鑰、OpenAPI 路由落點、SDK 尚待 AI-4 Gate；草稿不得標記 LIVE。
- 錯誤建議（待 AI-4 定案）：`AUTH_REQUIRED` 401、`APP_SCOPE_DENIED` 403、`ENVIRONMENT_DENIED` 403、`TRANSACTION_ALREADY_BOUND` 409、`IDEMPOTENCY_CONFLICT` 409、`UNVERIFIED_PURCHASE` 422、`SKU_NOT_REGISTERED` 422、`PROVIDER_TEMPORARILY_UNAVAILABLE` 503。

## 4. 測試 / 威脅矩陣
|情境|預期|
|---|---|
|成功購買、續約、有效到期日、一次性非消耗型|僅授權被核准 SKU/App/帳號|
|Client forged paid/verified marker；Apple unsigned/JWS wrong signer；Google unauthenticated RTDN|拒絕；只有真正 provider adapter 可建立 internal verified event|
|事件重送、同 event ID 不同 payload、並發驗證、當機後重試|單次入帳、衝突隔離；D1 原子測試待做|
|逆序續訂與舊期間退款、已到期、退款、撤銷、hold/grace|不錯誤覆寫較新已驗證權益，未知政策預設停權|
|跨帳號復原、跨 App、跨品牌、正式/沙盒互通、錯 bundle/package、錯 store/SKU|拒絕、不可寫任何另一會員/品牌資料|
|退款管理人無 scope、錯 app、MFA 過期或缺核准紀錄|拒絕，不會執行 store refund|
|會員停權／刪帳／token 撤銷|不可透過保留 entitlement 绕過 AI-1|
|Apple StoreKit testing / Google Play test purchase 以及原生 EAS|待 AI-4 native harness；Expo Go 不可當成付款驗收|

## 5. ADMIN-PREP P01～P10（AI-2 部分）
- **P01/P02**：Starry-only app/store/env/SKU registry、OpenAPI Draft v0.1；需對齊 AI-4 App ID／SDK／錯誤碼。
- **P03/P04**：僅必要的 Billing 管理 API，AI-1 發出可信 admin principal／權限、brand/app/env+step-up，後端預設拒絕。
- **P05/P06**：擬定 `billing.purchase_verified`、`billing.renewed`、`billing.refund_recorded`、`billing.entitlement_changed`，沿用事件 envelope `event_id,event_type,schema_version,brand_id,app_id,environment,occurred_at,correlation_id,resource_type,resource_id,result,idempotency_key`；稽核採遮罩、最小 actor/action/approval，不記 secrets。尚無實際事件 emission。
- **P07/P08**：未來 payment failure、退款、驗證延遲、webhook 重試、隔離佇列、費用/收入來源分開量測；目前無真實指標。
- **P09**：Draft PR、commit SHA、CI／本地測試可驗證；未做 EAS/Workers 部署、商店審核。
- **P10**：未來商品版本、app/brand/env、後端付款開關、變更者/原因/回復/稽核；目前無生產設定。

## 6. GitHub-only HANDOFF / Gate 1 阻塞
- **AI-1 #2**：Starry s_user_id 簽章/Session、Admin `billing:refund:review`、step-up/撤權、帳號綁定 proof API。未就緒不得接權益。
- **AI-4 #5 / Draft PR #20**：app_id、bundle/package registry、Workers OpenAPI route/error、Expo EAS native sandbox harness、CI 整合。AI-2 不修改 AI-4 base。
- **AI-0 #1 / Draft PR #19**：P01/P05 共用契約、SKU/寬限期/跨 App 權益決策、Gate 1 API 版號。
- **AI-3 #4**：P05/P06 Event Envelope、遮罩稽核、重試/dead-letter/安全事件。
- **本輪本地驗證**：`tsc --project tsconfig.billing.json`，`node --experimental-strip-types --test packages/billing-contracts/test/*.test.mjs`：12/12 通過。這些是 deterministic mock tests，**不是商店、Workers、D1 或原生設備測試**。

Official future integration references: [Apple App Store Server API](https://developer.apple.com/documentation/appstoreserverapi), [Apple Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications), [Google Play purchase verification](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get), [Google RTDN](https://developer.android.com/google/play/billing/rtdn-reference).

## 7. AI-0 第二輪 Gate 2 契約增量（2026-10-26；仍為 Draft）
- **雙環境軸**：`environment=development|staging|production` 是後端 Worker runtime；`store_environment=sandbox|production` 是 Apple/Google 商店。此輪只允許 runtime `development|staging` × store `sandbox`，任何 Production、混用 App/Bundle/Package/brand 預設拒絕；D1 設計稿現在分開存這兩欄，**絕不執行 migration**。
- **AI-1 v0.2 後端身分**：`packages/billing-contracts/src/trusted-adapter.ts` 的 `Ai1AuthPort` 接收**不透明的** AI-1 `TrustedStarryPrincipal`，經 AI-1 `billingIdentityAdapter`（產生品牌／App／runtime／store／userId）與 `billingRefundReviewAdapter`（grant/step-up）取得伺服器驗證身分；AI-1 的 module WeakSet/當前 Session/會員狀態仍由 AI-1 真實後端介面負責。**AI-2 沒有複製或建立第二套 Auth**。目前 port 在獨立單元測試使用假後端，**不得把該假實作搬到 Worker**。原 `verifiedBy`/`previouslyProcessedEventId` 仍僅 reducer 測試模擬，不是 HTTP 可接受旗標，不等於真實 store verifier 或 D1 原子重放保護。
- **HTTP 拒絕非權威欄位**：購買候選只可傳 `store`、opaque `evidence`；後端信任 registry 決定 app/environment/storeEnvironment；退款 review 只可傳 `transaction_ref`、`reason`、`approval_id`，交易所有者需再由 Starry Billing ledger 查得。所有 `adminVerified`、`verifiedBy`、`s_user_id`、`app_id`、`environment`、`store_environment`、`previouslyProcessedEventId`、`isPaid` 混入 client payload 一律拒絕。退款 review 不會執行退款或移轉權益。
- **P05/P06 parity（非複製 canonical DTO）**：`toCanonicalBillingEnvelope()` 明確映射 AI-0 PR #19 最小 envelope 11 個必填欄位，`occurred_at` 可為 RFC3339 UTC `Z` 或合法時區 offset，禁止偷偷攜帶 raw token／會員私密欄位。AI-3 PR #21 負責 audit/domain records；AI-4 Gate 2 整合時必須對 AI-0 `isStarryEventEnvelope` 做真實 canonical import/validator 測試，並處理 event retry/idempotency，不應部署另一份通用 envelope。
- **已核對 AI-1 介面差異、需跨組修正**：AI-1 v0.2 `billingIdentityAdapter` 已輸出 `runtimeEnvironment` 與 `storeEnvironment` 兩軸；但當前 `billingRefundReviewAdapter` 回傳舊式 `environment:'sandbox'`，與 AI-0 第二輪 runtime environment 決議不一致。AI-2 不修改 AI-1 程式；AI-1/AI-4 Gate 2 應更新 mapping，並將 `environment` 僅指 Worker runtime、`storeEnvironment` 僅指商店。此差異未修正前**不得把退款路由接上線**。
- **測試計畫／真實限制**：既有 12 組 sandbox policy + 新增 10 組 server adapter/跨帳號/撤權/偽造/重送/雙軸/P05 負向測試。可執行 `tsc --project tsconfig.billing.json` 和 `node --experimental-strip-types --test packages/billing-contracts/test/*.test.mjs`；GitHub CI run/SHA 以實際最終結果為準。依賴真實 Apple/Google cryptographic verifier、原子唯一帳本、AI-1 真實驗權、AI-4 Workers+OpenAPI 和 native sandbox harness 全未完成。
