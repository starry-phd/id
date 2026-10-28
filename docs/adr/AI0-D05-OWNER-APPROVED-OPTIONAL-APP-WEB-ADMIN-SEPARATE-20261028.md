# ADR D-05｜業主正式決議：每款消費者 App Web 選配，中央管理中心維持獨立 Web（2026-10-28）

> **決議：OWNER_APPROVED_OPTION_A / PER_APP_WEB_OPTIONAL / ADMIN_SEPARATE_APPROVED_STACK / NOT_IMPLEMENTED**  
> 業主原話：「**D-05 我正式選擇方案 A（每款 App 網頁版選配）。中央管理中心維持已核准的獨立 Web 架構。請記錄到 GitHub，說明實施範圍，繼續 D-06 下一題。**」

## 1. 已核准的 D-05 選型，與既有管理中心架構不可混淆

**消費者 App**：首批預計至少 10 款、長期容量目標 30–50 款，**各 App 獨立決定是否提供 Web 版**。行動版仍依 D-01 候選 React Native＋Expo＋Expo Router＋TypeScript，對需要 Web 的 App 優先考察 React Native Web（RN Web），但 **「Web 選配」不代表已核准 RN Web 版本、已完成相容性或指定所有網頁功能共享同一套 UI**。初始 `web_enabled=false`，特定 App 須另有需求/成本/原生差異/測試/發布決策。沒有 Web 的 App 可以只提供 iOS／Android，未來再增設；簡單的行銷官網也不等於完整 Web App。

**Starry 超級／中央管理中心**：沿用 **2026-10-26 第二波 V2.1 已正式核准的獨立 Web 技術選型**：
- React＋Vite＋TypeScript；
- Tailwind CSS＋shadcn/ui；
- TanStack Router＋TanStack Query＋TanStack Table；
- React Hook Form＋Zod；
- 圖表 ECharts 或 Recharts **兩者仍待第二波擇一**；
- Mobile-first Responsive Web，PWA 按需要選配；
- Cloudflare Workers＋後端權限校驗的 Starry 專屬管理 API/OpenAPI TypeScript SDK；
- 第二波 UI 尚未授權啟動/部署，第一波只保留 ADMIN-PREP P01～P10 的後端接入準備。

**此 D-05 不得把 Starry 管理中心改成 RN Web**、不讓各消費者 App 的 Monorepo 直接控制 Admin 路由、Admin RBAC 或管理用 D1/Secrets。H-Global 若未來復工，其管理員 Auth／Session／Cloudflare／D1 與 Starry 完全獨立；此案 H-Global 持續不施工。既有 V2.1 正式技術決議優先於 D-05 候選技術包的一般建議；也不因此啟動第二波建置。

參考： [Starry 共用技術基座 v1.0 候選包 §2.1、§2.3、§11 D-05](https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ/edit)、GitHub Issue「SECOND-WAVE V2.1 已核准待開發」及 [ADMIN-PREP #13](https://github.com/starry-phd/id/issues/13)。

## 2. 首階段私有 App Monorepo 與每 App Web 判斷

- [D-02 已正式選 A](./AI0-D02-OWNER-APPROVED-PRIVATE-APP-MONOREPO-20261028.md)：未來「**新建的單一私有 Starry 消費者多 App Monorepo**」內每款 App 可獨立選擇是否開 Web 輸出，並保有 `app_id`、`bundleIdentifier`／`androidPackage`、URL/Domain、Web 部署環境、CI、隱私、實際 Web 支援功能清單及上線 Gate。**新 Repo 目前尚未建立，本案也未核准建立**。
- [D-03 已正式選 A](./AI0-D03-OWNER-APPROVED-REVENUECAT-BILLINGCLIENT-20261028.md)：RevenueCat＋自有薄 BillingClient 的**原生 Store 購買權益**仍由 AI-2/DEV-B 驗證；Web 若有登入、內容存取或付費必須獨立處理 Web 端合規、購買/權益/支付提供者支援與平台規則。**不可自動把 iOS/Android RevenueCat SDK 的實作或購買 API 直接當作 RN Web 可用／合法的結帳方案。**D-07 跨 App 付費仍未決。
- [D-04 正式選 C](./AI0-D04-OWNER-APPROVED-ADS-COMPARISON-20261028.md)：廣告供應商尚未選定，且 AdMob/Mediation 的 App 原生廣告單元**不能直接視為 Web 合規適用**；Web 廣告需另比較供應商/資產/同意方式並核准，所有廣告預設關閉。
- 中央會員及免費 Starry Battery 的唯一 Auth、Billing、Battery Writer 繼續留在獨立的 Public `starry-phd/id` 中央服務。App Web 只經受控、版本化 AuthClient/BatteryClient/API/OIDC 方式存取；**不可直接連線中央 D1、複製 Central Session Key、直接暴露 Store/Cloudflare 秘密資訊或讓 Web Client 管理自己的帳號權限**。
- 各 App Web 評估至少需檢查：真實用戶需求、桌面/瀏覽器價值、SEO/分享必要性、Expo/React Native Web/原生插件與深連結可用性、無障礙/多語、網域/隱私 Cookies/追蹤同意、安全登入/登出/撤權、Web 權益/付款限制、成本/維運/部署、跨平台資料一致性、iOS/Android/Web 功能落差與回退方式。
- **禁止**因「首批 10 App」而強制每款 App 同時建 Web，或在未做市場驗證的情況下把 10/30–50 款都標示 `web_enabled=true`。每款的 `web_requested` 可以是候選，`web_approved`、`web_verified_native_compatibility`、`web_deployed` 必須分別保留證據。

## 3. 僅供未來已核准工程的候選 App Manifest（現在沒有動 App Factory）

```json
{
  "app_id": "synthetic-future-app",
  "mobile": { "ios": "proposal", "android": "proposal" },
  "web": {
    "requested": false,
    "approved": false,
    "enabled": false,
    "domain": null,
    "platform": null,
    "verified_browser_auth": false,
    "verified_store_entitlements": false,
    "verified_ads_consent": false,
    "deployed": false
  }
}
```

這是 **零權限的合成說明樣本**，不是目前正式 App Schema／已建立 App，也不由本 ADR 自動修改任何既有程式。AI-4/DEV-I 在私有 Repo 實際建立及 D-01 PoC 核准後才可設計正式 Schema、Web Bundle 隔離、Web/Native CI 矩陣、逐 App Canary、回退策略。已交付其他 AI 的具名 App 不因 D-05 被擅自加入本工程或改 Repo。

## 4. 執行授權範圍與 Release 真值

| 項目 | 本次決議 |
| --- | --- |
| **D-05：每款消費者 App Web 版獨立選配** | **OWNER_APPROVED / Option A** |
| 第二波中央管理中心 Web 技術 | **延續原 V2.1 已核准**，此決議不更改也不提前開發 |
| 私有 App Monorepo 拓樸 | D-02 A 已核准選型，**實際 Repo 尚未核准建立** |
| 真實 RN Web SDK/Expo 插件及真機/瀏覽器 PoC | 未實作；需獨立測試/授權 |
| 任何 App Web domain、買賣/訂閱、廣告、追蹤、身份真資料處理、上線 | **NOT AUTHORIZED** |
| Starry 第二波 Admin UI、Admin Worker/D1、域名、PWA 發布 | **NOT AUTHORIZED** |
| Cloudflare/EAS/Apple/Google Store、paid plan、GitHub main merge、H-Global | **NOT AUTHORIZED** |
| D-06 服務費用、D-07 跨 App 權益、D-08 UI | 仍待決議；不得因 D-05 被視為核准 |
| 官方中央發布門檻 | **G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false** |

本決議僅由 AI-0 提交文件、機讀決議和離線防越權測試，不修改 AI-1/2/3/4 原始碼、現有 npm/Expo 版本、正式 Worker、Cloudflare、GitHub workflow 或 Production。

## 5. 權責與後續

**AI-0** 記錄 D-05 正式決議、逐 App Web 開案 Gate；**AI-4** 之後僅在獲准建立私有 App 工程後實作可選 RN Web、瀏覽器身份／插件相容驗證、逐 App CI；**第二波 Starry 管理中心負責者**依 V2.1 技術標準另案啟動，不由任何 App Factory 自動產生。**AI-1** 保留中央身份驗證權威；**AI-2** 保留 RevenueCat Store/付費權益權威；**AI-3** 保留免費 Battery 權威；H-Global 不施工。

下一題 D-06：分別討論 GitHub、EAS、RevenueCat、Cloudflare 的**每月費用與超額控制、額度／允許項目**。已選 D-02～D-05 不代表任何新訂閱／支出獲核准。
