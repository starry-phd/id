# ADR D-07｜業主正式決議 A：每款 App 付費權益獨立，跨平台權益另行驗證（2026-10-28）

> **決議：OWNER_APPROVED_OPTION_A / CROSS_APP_PAID_ENTITLEMENTS_DENIED_BY_DEFAULT / CROSS_PLATFORM_SAME_APP_PENDING_VALIDATION / NOT_IMPLEMENTED。**
>
> 業主原話：「**D-07 我正式選擇方案 A（各 App 付費權益獨立）。請記錄到 GitHub，明確說明跨 App 與跨平台權益的授權及實施範圍，接著繼續 D-08 下一題。**」

## 1. 正式核准：跨 App **不共用**付費商品與權益

1. **A＝每款 Starry App 自己銷售、自己享有付費權益**。若會員在 App A 購買永久買斷、月/年 VIP 或「去廣告」，**不會因此解鎖 App B**；B 應呈現未購買/未訂閱，且不能接受 A 的本機付費 token、SKU、快取、廣告關閉旗標、Store Receipt 或 RevenueCat Entitlement 當作 B 的授權來源。
2. 每款產品 **`brand_id / app_id / ios_bundle_id / android_application_id / store_account / platform / product_id / entitlement_key / environment / user_id`** 的映射、退款/撤銷/恢復/到期與審核邊界必須以**業務 App ID** 範圍化；不是只比對 `user_id`。RevenueCat `app_user_id`／CustomerInfo／Offerings 也不得在未做 App scope 控制時被誤認為全球 VIP 或授予另一 App。
3. **Starry 中央會員 ID 和免費 Starry Battery 繼續共用**：中央 AuthClient/BatteryClient 與免費 Battery 不屬於付費商品、不得收費、不可被 A 的購買或跨 App VIP 判定影響。**「中央會員同一個人」≠「App 權益互通」**。
4. **不啟用生態系聯合 VIP、跨 App 解鎖、跨 App 去廣告、集中付費折抵或套餐**。未來若要引入方案 B／C，須業主另行正式 ADR、Store 合規/訂閱/退款/資料/公平定價真實驗證及 AI-2/AI-0 核准，不因首批 10 款計畫擅自預留可被啟用的 Global VIP。
5. **此處的「獨立」是商品與權益範圍，不要求每款 App 各建立一份重複的中央會員、Battery 或 Billing 後端**；它們仍共用可信中央 API/版本化 SDK，由 AI-2 作為唯一正式 Billing 購買事實/授權投影擁有人。

## 2. 嚴格區分「跨 App」和「同一 App 跨平台」

**跨 App（App A → App B）**：已由本次 D-07 A **明確不允許**跨產品的付費權益相互開通，即使共用同一 Starry 帳號亦不許。

**同一 App 的 iOS ↔ Android／選配 Web**：是**另一個議題**。本次 A **沒有批准，也沒有禁止**同一產品在不同平台透過受信帳號/商店政策合法同步原有「內容使用權」；需由 AI-2/DEV-B 和 AI-4/DEV-I 後續核對 StoreKit／Google Play/RevenueCat 身份映射、商品類型、收據真實性/退款、沙盒與實際 App 登入後才逐 App 核准，明確區分：
- **商店交易恢復**：同一商店的合法同帳號 Restore/狀態復原，與跨 Apple↔Google 的「把 Apple 收據當 Google 收據」**不相同**。Android 不能聲稱原生地直接恢復一筆 App Store 購買，反之亦然；若政策允許，應由受信中央 Billing 後端映射同一業務 App 的有效權益，而非複製/偽造異平台商店交易。
- **商品/訂閱類型**：永久內容解鎖、消耗型商品、訂閱、去廣告、按平台服務條款受限；不可一律假定全部可攜、免審/合法。各 App 須記錄「支援的平台／商品／恢復規則／退費規則／內容可用性」，實際可否轉移由商店政策與測試證據決定。
- **Web 選配（D-05 A）**：沒有 Web 的 App 無此義務。若某 App 開 Web，Web 權益/付款、身份 cookie/session、App 下載入口、商店外付費政策由另案核准；**RevenueCat 的原生 iOS/Android SDK 不能直接當 Web 收銀機**。
- **禁止交叉環境與身分提升**：sandbox≠production；不得 App A 的 Store transaction 出現 App B 或讓 Guest、另一會員、另一品牌 H-Global、不同環境直接取得權益。付款前後登入/匿名合併須 AI-1/AI-2 有明確規則和安全測試。

因此資料模型應保留 per-App per-Platform 的權益來源和已核實狀態，並且另外標示 **`same_app_cross_platform_portability_policy=UNDECIDED`、`portability_verified_live=false`**；**不能因本次 D-07 A 就宣稱 iOS→Android 已支援，或誤把同 App 同步當成全球跨 App VIP**。

## 3. 與 D-02～D-06 已核准選型的相容

| 決議 | 保留內容 |
|---|---|
| [D-02 A](./AI0-D02-OWNER-APPROVED-PRIVATE-APP-MONOREPO-20261028.md) | 未來首階段一個**新私有 Starry App Monorepo**；各 App SKU/Bundle/manifest/環境獨立；既有 Public `starry-phd/id` 中央 Auth/Billing/永久免費 Battery 獨立唯一 writer、不遷入、不複製 |
| [D-03 A](./AI0-D03-OWNER-APPROVED-REVENUECAT-BILLINGCLIENT-20261028.md) | RevenueCat＋自有薄 BillingClient 僅為**架構選型**；AI-2/DEV-B 正式後端單一權益權威，退款/撤銷/續期/去廣告必須可信校驗，不可客戶端自報成功 |
| [D-04 C](./AI0-D04-OWNER-APPROVED-ADS-COMPARISON-20261028.md) | 廣告平台尚未決定；App A 的去廣告付費不能停掉 App B 廣告；所有未核准 App Ads OFF |
| [D-05 A](./AI0-D05-OWNER-APPROVED-OPTIONAL-APP-WEB-ADMIN-SEPARATE-20261028.md) | 每款 App Web 選配；Starry 第二波管理中心獨立 React/Vite/TanStack 技術不變，Web 端 Store/Web 交易另審 |
| [D-06 A](./AI0-D06-OWNER-APPROVED-FREE-FIRST-INDIVIDUAL-SPEND-APPROVAL-20261028.md) | 免費優先，**任何新增付費及超額升級逐筆批准**，月預算金額未決；本 D-07 **不核准**商店商品建立、收費、RevenueCat 計費、EAS 或 Cloudflare 新資源 |

## 4. 未來真實權益測試的負面案例（目前只列規格，沒有執行沙盒）

- App A 的有效月 VIP、永久去廣告、買斷商品放到 App B：**全部 fail-closed**，包括產品 ID 字串相同但 App 不同、中央 `user_id` 相同、RevenueCat CustomerInfo 似乎相同。
- App A iOS 有效訂閱，App A Android 尚未真驗證：**不得謊稱 Android 已購買/恢復商店交易**；若未來批准同 App 跨平台權益，同時記錄兩個 Store 來源及可信 Billing 投影，不跨 App 授權。
- App A iOS 退款/撤銷、月/年續訂/到期、試用/寬限、永久去廣告仍有效、匿名→登入遷移：必須正確撤權/保權，不因跨平台/重播延長權益，禁止在 App B 顯示已買斷。
- 新 App 重用既有 Store `product_id` 字面值、跨平台 ProductMapping 錯配、`environment` 穿越、`app_id` 偽造、Replay Webhook、跨會員同手機/Email：不能形成跨 App 權益；業主正式中央會員/手機規則仍獨立有效。
- 憑 RevenueCat SDK 客戶端自報 `active`、未核實 webhook/RTDN、離線快取或合成測試 token：**不得成為永久中央授權權威**；官方 Store、RevenueCat 受信狀態、AI-2 唯一 writer 與冪等/P05 必須實際測試。
- 免費 Battery 不消耗 Store/跨 App VIP 權益，不能用 VIP 換購、抽取或恢復 Battery 餘額。

## 5. 授權與責任邊界

**已獲批准的只有 D-07 A 商業權益隔離規則與架構設計**。可以做本 GitHub ADR、機讀規格、離線測試和唯讀 Store 規則分析；尚未授權：
- RevenueCat 建帳、SDK 安裝、Store 訂閱/SKU/新商品、真 Sandbox 買賣/退款/恢復、跨平台生效；
- 新私有 App Repo、EAS iOS/Android Native Build、Worker/D1/Queue/Secrets/正式資料、Production/Web/Ads、main 合併或付費；
- 全球聯合 VIP／跨 App 預設去廣告、跨 iOS↔Android 權益自動合併、H-Global 開發。

**AI-0** 維護業主 D-07 正式選型；**AI-2／DEV-B** 依 App 身分/Store 交易建立唯一後端權益投影與跨平台沙盒驗證方案；**AI-1** 維護中央帳號和身份可信關聯；**AI-4** 處理 App Manifest、Expo SDK 商品映射與 Native UI/SDK，**AI-3** 持續保持免費 Battery。任何實際工程必須另經專責/Gate 和業主核准。

目前 **G00～G10 11/11 BLOCKED、P05/PUBLISHABLE=false**；下一題 **D-08：StyleSheet＋Design Tokens vs NativeWind/Tamagui 等 UI 實作**，尚待業主選擇。
