# ADR-0002 (DRAFT)｜Starry 數位 IAP：自建 vs 代管訂閱

- 日期：2026-10-26｜Owner：AI-2｜Issue #3｜依據：AI-0 [重啟 PR #25](https://github.com/starry-phd/id/pull/25)，`BILL-001=approved`、`BILL-002=candidate`、`DATA-001=approved`
- **狀態：選型未定、待業主與 AI-0 Gate**。這是中立評估／Sandbox 隔離驗證，不是決定購買 RevenueCat，也不是已部署商店驗證器。
- 範圍：僅 Starry 生態系數位 IAP；**Starry Battery 永久免費，不得隨數位購買發放電池、餘額、儲值**。H-Global PAYUNi／實體票券屬其他未啟動的獨立專案。

## 問題與選項

| 決策面向 | A：自建 Workers + Store Server API + Starry Billing | B：代管訂閱（例：RevenueCat） |
|---|---|---|
| 持續費用 | 無額外 IAP 中介平台抽成；仍負擔 Workers/D1/Queues/API 整合、監控、工程維護、Apple/Google 商店費用 | 另有平台計價與費率變動風險，仍負擔自身 D1/Workers、App 商店費用及整合維運；請以訂約日官方報價為準 |
| 已知官方報價參考 | 自建人力成本未估；不可假設零成本 | RevenueCat 官方價目頁 2026-10-26 核對：Pro 月度追蹤營收 MTR 不超過 US$2,500 時平台費 US$0；之後頁面標示按追蹤營收 1% 計費。需核對 MTR 定義、適用區域、條款與未來變動，**未開通／未購買** |
| 交易／隱私資料控制 | Starry 保有 provider transaction refs、會員綁定與最小化 ledger；需自行落實可見權限、保留政策 | 代管廠商處理訂閱事件／識別資訊，須審查 DPA/出口、個資目的與刪帳、事件保留與資料匯出能力 |
| 官方事件 | 自行驗 Apple Server Notifications V2 signedPayload／內層 transaction JWS、Google Pub/Sub RTDN + authenticated requery Play Developer API | 代管者處理商店事件；Starry 仍須**驗證代管 webhook 真實性與 freshness**、reconcile 來源，不得直接信任客戶端 SDK success |
| 退款／撤銷／chargeback | 自建解除權益、逆序重播、客服審核、失敗補償、寬限期政策 | 依服務商 normalized events 判斷，但應允許透過商店端查證、爭議對帳及回溯；代管事件不能取代 Starry 權益 owner |
| 跨 Starry App 資格 | 先採 App-scoped；如要跨 App 共用 entitlement，需 SKU／商店帳號／原始交易權屬與授權策略、商店政策核准 | 某些廠商支援 entitlement 映射；不同 App Store/Google Play package 與應用 bundle 的權益共用仍應逐案確認，不能因同 Starry ID 就預設轉移 |
| 故障與遷出 | 需規劃 provider 連線中斷、重試、密鑰輪換、SDK 升版；store API 不可用時 fail closed | 另有 vendor outage/價格變更／停用風險；要求 transaction/owner/entitlement 歷史匯出、雙路 shadow reconcile、重播驗證及回退窗口 |
| 工程時程 | 首版更重，需專人持續跟 Apple/Google 規則變動 | 可縮短整合但新增第三方依賴與收費；真正省工需用 sandbox 實驗證明 |

## 對兩方案不變的防護與 SSOT
1. **Starry ID（AI-1）** 是 `s_user_id`、Session、停權及高風險管理授權的唯一權威；client app/user/paid/verified/admin 標記全不可信。**Starry Billing（AI-2）** 是商品、交易 owner、entitlement、事件 ledger/outbox 的唯一寫入者；**Audit（AI-3）** 持有稽核投遞/保留責任。跨品牌完全隔離。
2. `environment=development|staging|production` 為 Worker runtime；`store_environment=sandbox|production` 為商店環境。**本輪僅 development/staging × sandbox**，正式扣款及 Production 一律禁止。
3. 商店 owner 以 Apple appAccountToken、Google obfuscatedAccountId 等可供比對的**已驗證 provider binding**（確切欄位和生成演算法待核准）連結後端不可變 `s_user_id`；禁止以 Email／相同姓名／客戶端輸入搬移權益。Ledger 僅存不可逆 reference/digest；勿存 raw JWS、購買 token 或付款資料於日志。
4. **事件可晚到／重送／逆序**。Apple Server Notifications V2 `signedPayload`（及內層 transaction/renewal JWS）須完整驗簽、驗證 bundle/appAppleId（適用時）、商店 environment、SKU、transaction lineage；Google RTDN 必須驗 Pub/Sub 傳輸身分且重新用 Developer API 查權威購買狀態，驗證 package/product、state/expiry/ack、linked token。遺失通知可後端定期 reconcile。通知本身不直接發權。
5. 免費 Battery 完全獨立，`GRACE_PERIOD`、`ON_HOLD`、`EXPIRED`、`REFUNDED`、`CHARGEBACK`、`REVOKED` **預設 inactive**，直到業主核准寬限期/退款逆轉/非消耗型/跨 App entitlement 政策。不要把這些預設安全測試當最終商品政策。
6. D1 原子界線：owner first claim + provider event UNIQUE/idempotency digest + entitlement version CAS + outbox 在**同一筆交易**落地或一起 rollback；失敗通知由 AI-3 處理。D1 實體資料庫數量尚未決議，不可假定跨 D1 實體也具單交易 ACID。保留 quarantine 與人工對帳，但不得自動轉移他人交易。

## Apple / Google 事件範例流程（未實作正式 adapter）
- Apple：V2 signedPayload → **可信驗簽** → 驗簽 signedTransactionInfo/signedRenewalInfo → `originalTransactionId` 分群、`transactionId` 單期歸屬、退款/撤銷 timestamp → Starry-only 原子 event ledger/outbox。
- Google：Pub/Sub auth+RTDN → Google Play Developer API 查 subscription v2 或 one-time purchase → package + purchase token + linked token + 會員綁定 → Starry-only 原子 ledger/outbox。
- Replay：相同可信 event scope + providerEventId/transaction + digest 為 no-op；相同 key 不同 digest 進 quarantine，**不能更新權益**。歷史退款不得撤銷較新已驗證期間，但同期間 refund/chargeback 不得靠舊「PAID」復活。
- Provider outage：延遲/重試並記錄狀態，不允許 request 當成已付款；必要時權益讀取由保守伺服器現有狀態及已核准政策決定，驗證缺失絕不新增 grant。

## 待業主／AI-0 Gate 決策
- A 或 B 或先 A mock、再 B 試驗；實際總成本（交易量、MTR、商店費率、工程維運）與資料/隱私條件。不得預設 RevenueCat 已取得授權。
- 單一 Starry 旗艦 App 的 bundle/package、Sandbox SKU、月/年與非消耗型產品與價格；購買與恢復資格的 first-bind 來源；跨 Starry App entitlement 是否允許。
- 退款回復、chargeback、grace/hold、欠款與期限、權益刪除/匿名化、稽核保留與輸出；正式 D1 配置和 concurrent Gate。
- AI-4 需正式 Server API adapter/SDK/OpenAPI/CI/native EAS sandbox；AI-1 需真正 OIDC/JWKS/session/停權；AI-3 需 audited outbox consume/retry；AI-0 才能 Gate。

**官方資料（檢視日 2026-10-26，價格與規則以官方最新為準）**：
- RevenueCat pricing: https://www.revenuecat.com/pricing
- Apple Notifications V2: https://developer.apple.com/documentation/appstoreservernotifications
- Apple signed payload: https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2
- Google RTDN: https://developer.android.com/google/play/billing/rtdn-reference
- Google Play Developer API: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
