# ADR D-08｜業主正式決議 A：React Native StyleSheet＋Design Tokens＋自有共用 UI 元件庫（2026-10-28）

> **狀態：OWNER_APPROVED_UI_ARCHITECTURE_ONLY / NOT_IMPLEMENTED / NATIVE_POC_PENDING。**
>
> 業主原話：「**D-08 我正式選擇方案 A（StyleSheet＋Design Tokens＋共用 UI 元件庫）。請記錄 GitHub 並說明授權範圍，彙總 D-01～D-08 所有決議。**」

## 1. 決議精確效力

Starry **消費者 iOS/Android App 的第一階段 UI 基線正式選 A**：以 React Native 內建 **StyleSheet** 定義基礎樣式，以**語意化 Design Tokens** 管理共用設計值，在未來新私有 App Monorepo 中維護**自有版本化共用 UI 元件庫**。這是**業主已核准的設計選型**，**不是**真的安裝套件、建立元件套件、Expo SDK 58 PoC 完成或有任何 App UI 已開發/部署。

具體範圍：
1. 共用機制、非共用產品畫面：基礎 `Button, Text, Input, Card, Badge, Dialog, FormField, Loading, EmptyState, ErrorState`、字體級距、間距、圓角、色彩、陰影/層級、深色/淺色主題、無障礙狀態、焦點/點擊區域等**只列候選契約**，由 AI-4／DEV-I 依第一批實際 App 需求實作；不承諾每種元件必須一開始全部完成。
2. **Tokens 依品牌/每款 App 可覆寫**：共用語意角色（例如 `color.background, color.text.primary, color.action.primary, space.md, radius.card, typography.body`），每 App 可各自設定品牌顏色、字型、圖示、版面/內容/導覽/收費顯示；不得全 App 被迫共用同一套 UI 畫面、圖片或產品定位。
3. **核心共用套件必須是呈現層**：UI library 不能持有中央登入 Session/金鑰/個資，不可直連 D1、不能讀寫免費 Battery 餘額，不能驗證/授權付費；必要的登入/購買/電池 UI 只消費版本化 `AuthClient` / `BillingClient` / `BatteryClient` 的狀態 DTO，可信判斷仍屬各原 Owner。
4. **使用 RN StyleSheet 不排斥原生無障礙、動畫、手勢/表單等必要套件**；但採用 NativeWind/Tamagui 作全 App **預設 UI 基線不在本次核准範圍**。不鼓勵提前引入第二套全面性 UI runtime；如未來真的有可量化效益，必須獨立比較 PoC＋業主新 ADR，亦不以本案強制移除既有任何已被其他人正式核准使用的元件。
5. 版本化／兼容政策：建議 `packages/ui` 與 `packages/design-tokens`（**未建立，目錄僅為候選**）採語意版本／變更紀錄/變更分類，變更共用 Button 不等於 10～50 款 App 一起發布；由 per-App CI、受影響檢測和逐 App 發版 Gate 決定。先以 1～2 款合成/已核准 App 做 Canary，避免主題升級造成大量回歸。
6. 響應式/字型擴大及多語、深色模式、螢幕閱讀器、觸控區域、螢幕尺寸/鍵盤/RTL（有需求時）和 iOS/Android 視覺一致性需**真 Native QA**；不能只依離線 StyleSheet 測試就宣稱兩平台正常。
7. D-05＝A 表示**每款 App Web 選配**；`StyleSheet` 共用元件對 Web 的相容性要每個選配 App 驗證 React Native Web、瀏覽器樣式/輸入/無障礙、SSR/SEO（如需），不因 D-08 A 就自動批准建立 Web。
8. **Starry 第二波中央管理中心的獨立 Web 技術選型完全不變**：React＋Vite＋TypeScript、Tailwind CSS＋shadcn/ui、TanStack Router/Query/Table、React Hook Form＋Zod，ECharts/Recharts 尚待決定；不得因 App 選 StyleSheet 而把 Admin 改為 RN Web、改寫/合併進消費者 `packages/ui`；同時 H-Global Admin/帳號/資料獨立且開發暫停。參照 [2026-10-26 已核准第二波 Admin #15](https://github.com/starry-phd/id/issues/15) 與 [ADMIN-PREP #13](https://github.com/starry-phd/id/issues/13)。

## 2. 和 D-01～D-07 已核准方案的綁定（正式狀態表，2026-10-28）

| 編號 | **業主正式決議／目前狀態** | **尚未因此取得的實作或平台批准** |
|---|---|---|
| **D-01** | **未正式選定**：Expo SDK 58／React Native 0.88、RevenueCat/廣告/監控等原生插件相容性是候選，需要真 Native PoC | 未獲新 Expo/RN 版本切換、真雙平台 Build、Store/Cloudflare/付費授權；現有中央 Expo 54／RN 0.81.5 不因技術建議強制升級 |
| **D-02** | **已核准 A**：未來首階段一個全新的**私有 Starry 多 App Monorepo**，目前 Public `starry-phd/id` 中央 Auth/Billing/永久免費 Battery Writer **保持獨立** | 沒有真的建立新私有 Repo、遷移任何 App、設置 ACL/Secrets/CI、部署任何新 App；後續 30～50 款的 Repo 轉型仍按實測另決 |
| **D-03** | **已核准 A**：RevenueCat＋Starry 自有薄 `BillingClient`，AI-2／DEV-B 是唯一受信付款生命週期/權益投影 Writer | 沒有 RevenueCat 真帳號/SDK、商品/付費/退款/Store Sandbox，不能把 client 自報/未驗證 webhook 當購買成功 |
| **D-04** | **已核准 C（研究策略）**：先比較 Google AdMob Mediation／AppLovin MAX／Unity LevelPlay；**實際廣告供應商未選定**，Ads 預設 OFF | 沒有批准任何廣告服務商/SDK、Ad ID、廣告投放、追蹤、Consent 收集、計費或真原生廣告 PoC |
| **D-05** | **已核准 A**：各消費者 App 可自行選配 Web（初始 OFF）；Starry 第二波獨立 Admin Web V2.1 技術維持原決議 | 沒有每款 App Web/網域/付款/廣告/Deploy 核准，也**沒有啟動第二波管理中心 UI** |
| **D-06** | **已核准 A**：免費額度或現有已批准付費方案優先；**任何新增付費、超額升級/用量加購必須個別獲業主批准**；具體月度預算金額**未決** | 沒有自動支出授權、付費方案/額度增加、取消現有續費的權限；花費預警≠硬停費，供應商被動既有計費需查核 |
| **D-07** | **已核准 A**：每個 App 買斷/VIP/去廣告權益互不跨 App；中央會員與免費 Battery 共用 | **同一 App iOS↔Android/選配 Web 權益攜帶仍未決**，須 StoreKit／Google Play/RevenueCat 身分和退款/恢復真沙盒驗證，不能把 Apple 收據當 Google 交易 |
| **D-08** | **本次已核准 A**：React Native StyleSheet＋語意化 Design Tokens＋自有版本化共用 UI 元件庫，App 視覺可個別客製 | **沒有建 UI Package、發布新 App、安裝全套 UI 系統或原生 QA**；NativeWind/Tamagui 不作首版預設基線，未來評估需新 ADR |

**數量：D-02～D-08 共 7 項已獲正式業主架構／政策選擇；D-01 仍是尚待原生實測與正式版本決議。** D-04 的「選 C」不等於最終廣告供應商已定；D-06 的「選 A」不等於有月費預算；D-07 的「選 A」不等於同一 App 已能跨 Store 恢復購買。**決議已核准 ≠ 工程已實作或可上線。**

## 3. D-08 執行分工、具體 Gate

- **AI-0**：記錄決議、機讀規格、跨 App 不重複 Writer 的 UI 依賴邊界、逐 App CI / release 門檻，不修改其他 Owner 原始碼。
- **AI-4（DEV-I）**：日後在獲准建立的新私有 Monorepo 中建立候選 `packages/design-tokens`、`packages/ui`、per-App Theme；協同 DEV-G 的 SDK 版本契約，確認 Expo/RN/React Native Web 相容與效能；不直接新建真 App、部署或升級 Expo 版本。
- **AI-1/AI-2/AI-3**：只提供 Auth/Billing/免費 Battery 版本化狀態/DTO，UI 不能自行改會員、扣 Battery 或永久發 VIP/去廣告。
- 真驗收至少要：被核准的合成 App/環境、iOS/Android 發展版 Build、暗/亮模式與字體級距、低階機效能、跨 App 視覺隔離、無障礙／螢幕閱讀器、共用 Tokens 變更受影響 CI、單 App 回退、選配 Web 的獨立瀏覽器測試。需記錄 SHA、Build ID、平台/版本/裝置、失敗與回退證據。
- **D-06 A 價格管制有效**：任何 Expo/EAS、GitHub Actions 超額、新 Cloudflare、付費 UI 元件、測試帳號或計量費，均須具體費用逐筆由業主批准；本次不附帶新預算。

## 4. 本次授權界線與當前發布真值

**允許**：只在既有 `starry-phd/id` 受控 Draft branch 寫入這份 D-08 決議／D-01～D-08 真值總結、對應 machine-readable JSON、零外部資源之離線防越權測試；由 GitHub Issue 向 AI-0/1/2/3/4 同步。

**禁止／尚無批准**：建立私有 App Repo、建立 `packages/ui`/產品 App 原始碼、Expo/React Native 真機/原生 Build、套件安裝或 NativeWind/Tamagui 引入、雲端 Staging/Prod 新資源、RevenueCat 連線／Store Sandbox／廣告／網域／付費服務、main 合併、部署或商店送審、H-Global 新開發。

中央 **G00～G10 正式 11/11 BLOCKED、P05/PUBLISHABLE=false**；本回合的 GitHub CI 僅驗證來源決議和安全欄位，不代表真雙平台、交易、廣告或 release。實際工程開始需另有業主具體授權／DEV-I 正式原生 PoC。
