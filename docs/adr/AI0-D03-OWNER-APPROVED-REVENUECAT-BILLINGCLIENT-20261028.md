# ADR D-03｜業主正式決議：RevenueCat＋自有薄 BillingClient（2026-10-28）

> **狀態：OWNER_APPROVED_ARCHITECTURE / NOT_IMPLEMENTED / POC_PENDING。**  
> 業主原話（2026-10-28）：「**D-03 我正式選擇方案 A（RevenueCat＋自有 BillingClient）。請記錄到 GitHub，明確說明授權與實施範圍，再繼續 D-04 下一題。**」

## 1. 最高權威與範圍

- 正式首版**技術供應商選型 A**：**RevenueCat** 優先整合 **Apple StoreKit／Google Play Billing**，產品端只透過 Starry 自有、版本化的薄 **BillingClient**／Billing Adapter 介面呼叫。這是選型**已核准**，不是 RevenueCat 帳號已申請/訂閱、SDK 已裝好、原生測試已過、或任何一筆交易獲授權。
- 原 [SBASE v1.0 候選技術包 §4.1、§11 D-03](https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ/edit) 先推薦 RevenueCat＋自有薄介面，現由使用者**正式確定供應商方向**。既有 AI-2「RevenueCat vs 自建」候選 ADR 依本決議改為**歷史技術比較**；**不得雙線同時實作彼此競爭的付費交易權威**。
- [D-02 已核准 A](./AI0-D02-OWNER-APPROVED-PRIVATE-APP-MONOREPO-20261028.md)：前期**一個全新私有多 App Monorepo** 放置多 App 的**消費者薄 BillingClient／適配器**與各 App SKU／Entitlement manifest，**Public `starry-phd/id` 中既有中央 Billing/會員/Battery 唯一 Writer 邊界不移入新 Repo、不複製**。H-Global 維持獨立。

## 2. BillingClient 消費端範圍（介面形狀為技術包建議，實際 API 名稱待 AI-2 PoC）

`purchase(productKey)`、`getOfferings()`、`getEntitlements()`、`restorePurchases()`、`identifyUser()`、`logout()`、`observeEntitlementChanges()` **均為概念接口**。AI-2／DEV-B 對購買事實、官方交易狀態、退款／撤銷、訂閱續期／寬限／過期、收據對帳與唯一權益投影負責；AI-4/DEV-I 負責 Expo Native App 消費端封裝、建置及原生相容，並遵循 AI-2 正式契約。**不要把薄 BillingClient 當成另一個 Billing 後端權威**。

原則資料流（候選細節須 AI-2/Store PoC 後正式定型）：

```text
App A/B/... N（各自 SKU / app_id / Store Bundle）
  → BillingClient 薄介面 → RevenueCat SDK → Apple/Google Store
  → RevenueCat 的受信交易/狀態事件（Webhook 等；來源必須驗證）
  → DEV-B/AI-2 唯一 Billing 服務（驗證身份、App、交易、時序/冪等）
  → 該 App 個別權益投影 → 原 App UI、該 App 的 Ads 關閉
```

- **商品對應**：App 各自獨立 `app_id / bundle_id / package_name / product_id / offering / entitlement_key / test_mode`，必須由 Apple／Google 正式商店測試商品實際設定映射；不可跨 App 拿 A SKU 發 B 權益或讓 Remote Config 憑空創造商品。
- **共用會員不同於共用付款**：所有 App 使用 Starry 中央會員/免費 Battery 的**版本化 AuthClient、BatteryClient**。交易身份映射與轉換流程由 AI-1/AI-2 依最小資料與撤權規則審批；不得將 Email／真會員個資當未審查第三方識別碼，不因共用 `user_id` 自動共用 App A/B 付費權益。跨 App 訂閱或共享權益仍屬 **D-07 待業主決議**。
- **不得僅因 App 自報** `purchased`、本機快取或未驗證 Webhook／PubSub 通知就永久發權。退款、撤銷、購買恢復、去廣告、離線啟動均需 AI-2 正式生命週期和可信同步來源；受信事件應處理冪等與有期限狀態、不可先 ACK 未持久提交的交易。
- **免費 Battery**：與 App 內購永遠隔離，不能建 Battery 付費 SKU、以 Billing 事件產生免費 Battery 額度或重發首贈。AI-3 的 Battery 職責不轉給 RevenueCat。
- **廣告**：D-04 尚未批准 AdMob 方案。若日後採廣告，則該 App 有有效「永久去廣告買斷」或含去廣告權益的有效訂閱時停播；退款／訂閱失效後不能錯誤保留已撤銷權益；若仍持永久去廣告買斷，訂閱到期也**不得**重開廣告。

## 3. 保留未核准的執行／PoC 項目

| 項目 | 目前 |
|---|---|
| **D-03 技術供應商方案 A：RevenueCat＋自有薄 BillingClient** | **OWNER_APPROVED** |
| RevenueCat 註冊、App/Project/Offering、SDK 安裝、商店帳號串接或訂閱付款 | **NOT EXECUTED，需操作前核准** |
| 是否購買 RevenueCat 付費方案、以當期實際收入費率建立成本/超額警戒 | **另行經使用者批准 D-06；不能默認免費額度永久不變** |
| iOS＋Android RevenueCat 原生 development build 及收據／權益／恢復購買測試 | **PENDING D-01／AI-2+AI-4 真 PoC** |
| Apple/Google 沙盒的買斷、月訂閱、年訂閱、退款、取消、寬限、過期、去廣告與 App A→B 權益交叉負測 | **PENDING，須各平台測試帳號/商品與當次授權** |
| Webhook／交易唯一性、驗簽/驗證、同 App 映射、D1 CAS/outbox/P05、事件 ACK、稽核/法遵 | **PENDING，AI-2 正式設計；跨 D1 #87/P05/Q104/Q119 不因 D-03 被核准** |
| 自建 OpenIAP/react-native-iap 替代方案 | **僅保留備援比較，不得並行成第二購買權威** |
| 未來從 RevenueCat 退出/遷移到自建 | **需獨立專案：交易／訂閱客戶權益、ID 映射、Webhook、Store 帳號、對帳與客戶端發版；薄介面僅降低變更面，不能保證無痛切換** |
| D-04 廣告、D-05 Web、D-06 費用、D-07 跨 App、D-08 UI | **各自待決議** |

**禁止在未授權下**：建立實體私有 Repo／App/商店 SKU、修改正式 RevenueCat/Apple/Google 帳戶、使用真購買／扣款／付費功能、部署 Cloudflare、改已存在的 Billing Writer/Release Gates、合併 `main`、更新正式 App 或觸及 H-Global。

## 4. 驗收分工與真值

- **AI-0**：記錄正式選型、授權範圍、權威與跨 App 產品隔離；追蹤技術包 §8 PoC 項目與 GitHub SHA/Actions，禁止候選升格。
- **AI-2（DEV-B）**：定義 BillingClient 版本化契約、受信 Store 事件來源、伺服器權益/退款/唯一性/反重播、RevenueCat adapter 與 Store Sandbox 端到端 Gate。已存在 [AI-2 Draft #174](https://github.com/starry-phd/id/pull/174) 的 Google RTDN 合成 RSA 安全測試**仍是離線候選**；D-03 正式選 RevenueCat 後必須以單一正式交易權威重整其合法接入界線，**不能把合成 RTDN 當官方交易許可**。
- **AI-4（DEV-I／G）**：配合 [D-02 選定 A](./AI0-D02-OWNER-APPROVED-PRIVATE-APP-MONOREPO-20261028.md) 的消費者 App Factory、Expo Native Build、RevenueCat/AdMob 技術相容（D-04 待定），不私自重寫 AI-2 Store 後端。
- **AI-1/AI-3**：只提供 AuthClient/BatteryClient 契約、會員識別與免費電池權益界線，不重造交易業務規則。
- **Release 真值**：`docs/release-readiness/release-readiness.v0.json` 的 **G00–G10 11/11 BLOCKED**、P05/PUBLISHABLE=false、`release_authorization.granted=false`。本 ADR 僅選型核准、未執行任何真商店或 Cloudflare 操作。

記錄位置：[AI-0 共用技術包 #156](https://github.com/starry-phd/id/issues/156)、[AI-0 產品組合 #158](https://github.com/starry-phd/id/issues/158)、[AI-2 Billing #3](https://github.com/starry-phd/id/issues/3) 與 [總管 #1](https://github.com/starry-phd/id/issues/1)。
