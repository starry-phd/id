# ADR D-02｜業主正式決議：Starry 首階段單一私有 App Monorepo（2026-10-28）

> **決議狀態：OWNER_APPROVED_ARCHITECTURE／NOT_IMPLEMENTED**。
> 業主 2026-10-28 原話：「**D-02 我正式選擇方案 A。請記錄到 GitHub，說明這項架構決議的實施範圍，接著繼續下一題。**」
> 背景需求：全部 App **共用中央會員與 Starry Battery**，短期準備至少 **10 款** App 上架，長期技術容量目標 **30–50 款**。
> **本 ADR 是正式的 D-02 選型決議，不是新私有 Repo、商品 App、雲端資源、付費或發版的執行授權。**

## 1. 決議與權威

1. **選定 A：首階段一個全新 Starry 私有多 App Monorepo**；新 App 原始碼、App 專屬產品程式、共用 UI/Design Tokens、App Shell、AuthClient/BatteryClient/BillingClient 的**消費端 SDK／介面封裝**、Ads Adapter、Manifest/Registry、App Factory、CI／測試骨架集中於這個私有 Repo。它是第一階段預設工程方案，優先滿足約 10 款早期 App 的開發效率，而不是強行一次產生 10 個 App。
2. **中央 Starry ID 保持獨立既有工程來源**：`starry-phd/id` 為目前既有 **Public** 中央服務 GitHub Repo，不更名、不改 visibility、不移植其唯一 Auth/Session/Billing/免費 Battery 真資料權威、不複製其 Worker/D1/Queue 實作為第二份 writer；H-Global 保持完全獨立、不列入本私有 Repo。
3. **中央共用的是服務、會員 ID 與免費 Battery；每款 App 商業資產仍獨立**：以經核准的有版本 AuthClient、BatteryClient、BillingClient、OpenAPI 契約存取中央服務，不直連其 D1/私密金鑰；各 App 的 `app_id`、Bundle ID、Android applicationId、Store App、SKU、Ad Unit、商品權益、環境、發版版本、內容與主畫面都分開。**同一會員帳號不代表自動共享 App 購買或去廣告權益**；跨 App 權益屬 D-07 另案決議。
4. **初期工程組合**：依 [SBASE v1.0 候選技術包](https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ/edit)，將 **pnpm workspaces＋Turborepo** 列入新私有 Monorepo 之**首選實作候選**。這一條不是自動核准將現有 `starry-phd/id` 的 npm workspaces/Expo 54/RN 0.81.5 改成 pnpm、Expo 58/RN 0.88；D-01、native/IAP/Ads 插件等另須 PoC。新 Repo 具體 GitHub 帳號、Repo 名稱、建立／ACL／費用仍待執行前檢查及當次授權。
5. **既有具名 App 不強迫遷入**：其他 AI 負責的已開發／開發中產品不在本次單方面改 Repo 或搬遷範圍；需要時各 App 由業主另案核准。此決議不改之前的 GitHub main 或 PR 流程強制設定。

## 2. 採用範圍：預期的新私有 Repo 目錄（架構定義；尚未建立）

```text
Starry-private-apps (暫稱，實際 Repo 名稱未決)
├─ apps/
│  ├─ <first-app>/
│  ├─ <second-app>/
│  └─ ...                  # 首階段逐款立案；不預設已核准 10 款
├─ packages/
│  ├─ app-shell/           # App 共用啟動/路由/安全空狀態
│  ├─ ui/                  # Design Tokens + 共用元件（不做換皮同款）
│  ├─ auth-client/         # 唯一中央 Auth 的版本化 consumer adapter
│  ├─ battery-client/      # 唯一中央 Battery 的免費 consumer adapter
│  ├─ billing-client/      # APP-specific 商品映射，不擅建 Store 權威
│  ├─ ads-core/
│  ├─ api-types/
│  └─ config/
├─ tools/create-starry-app/  # App Factory：骨架、Manifest、測試
├─ docs/
└─ .github/workflows/
```

此圖只是**實施邊界**，不是實際已建立的資料夾或 App。一個 Monorepo **不等於**單一 App、單一 Bundle ID、單一商店商品或 10 款連動部署。

## 3. 每 App 獨立的安全門檻

- **正式產品立案**：依技術包第 9、10 節，每款 App 個別留下用戶痛點、與其他 App 的實質差異、功能/商業模式、App Manifest、成本／法遵／授權及測試記錄。AI-0 [#176](https://github.com/starry-phd/id/pull/176) 的 intake reviewer 只供**待人工證據審查**，不能自動讓 App 開發、收費或上架。
- **版本化 SDK**：不得 App A 直接 import App B 的畫面或商品內部狀態；Auth/Battery/Billing 共用 TypeScript/API 契約但不把中央 D1 schema 當公共 SDK。變更共用套件先跑受影響檢查，經 Canary 再分批推送。
- **私有 Repo 與 Secrets**：Private 是 IP／權限隔離，不是「可以提交 Secrets」；各 App 的商店 Key、簽章、Billing 憑證、Ad Unit、環境密鑰、真用戶資料都按最小權限分開。嚴禁將這些內容貼到目前 Public `starry-phd/id`。
- **商店／部署獨立**：單 App 可自行發 iOS/Android 版本、獨立失敗回退與審核，修一個 App 不得默默重發 10 款；獨立 Store SKU、AdMob 配置、Region/Privacy、去廣告及訂閱週期。
- **成長監測**：若 App 數接近 25、PR CI p95 超過 25 分鐘、原生插件版本分歧、產品移交／不同權限或專案容量壓力，**觸發 D-02 拆分方案評估**，不是直接自動把 Monorepo 拆掉。可以未來另案評估 B/C，**目前選 A 的決議優先於舊文件建議 C 的候選 ADR**。

## 4. 本決議核准／不核准邊界

| 事項 | 決議 |
|---|---|
| **D-02 首階段 Repo 拓樸** | **APPROVED: A／單一新的 Starry 私有 App Monorepo** |
| 先導 App 約 10 款／長期容量 30–50 | 產品目標/容量規劃；**不是 10 款已獲准開發/上架** |
| 共用中央會員／免費 Battery | **保留原正式架構**；只經版本化 Client/API；不複製唯一 writer |
| 新 Monorepo 實際 Repo 名稱、Owner、ACL、Secrets、每月費用 | **PENDING／建立前另行核對** |
| 建立 GitHub Private Repo、建立真 App、合併 main、原生 EAS/Store/Cloudflare Deploy | **NOT AUTHORIZED by this decision alone** |
| D-01 Expo 58＋RN 0.88 原生相容、D-03 RevenueCat、D-04 AdMob、D-05 RN Web／Admin、D-06 費用、D-07 跨 App 權益、D-08 UI | **PENDING，各自獨立決策/PoC** |
| Starry synthetic-only Staging 的**方向** | 另已同意規劃；確切資源、費用上限/ACL/回退未核准；不等於本 D-02 核准 |
| 中央 G00–G10／P05／商店權益、Battery 收費 | **G00–G10 11/11 BLOCKED；P05/PUBLISHABLE=false；Battery 永久免費** |

## 5. 舊文檔與執行驗收安排

- 本文明確覆蓋 **[AI-0 D-02 舊選項 C 候選 ADR](../operations/AI0-SBASE-D02-MULTI-APP-REPO-TOPOLOGY-ADR-20261028-DRAFT.md)** 的推薦（保留為歷史比較，不刪除）；契合 SBASE 第三章「第一階段首推單一 Starry 私有 Monorepo」。
- 後續 AI-0 收齊 owner/repo/ACL/cost/CI isolation 詳細實施審查；由 **AI-4／DEV-I** 在業主就實際 Repo 創建及原生開發授權後，按照專責範圍建置 App Factory、Expo/SDK 及 CI；AI-1/2/3 仍各管 Auth、Billing、Battery，維持唯一資料權威；AI-0 只審驗與決策追溯。
- 首批真實驗收：至少 3 個不同的**合成技術 PoC**、iOS/Android development build、每 App Package/SKU/Ads/Env 不互串、SDK 變更後的 affected tests、個別發版/回退、實際 CI 時長/成本（**現階段仍未實際完成**），不得誤當 3 款商業 App 上線。
- 本決議記於 AI-0 [產品組合 Issue #158](https://github.com/starry-phd/id/issues/158)、[共用基座主控 #156](https://github.com/starry-phd/id/issues/156) 及 [總管 #1](https://github.com/starry-phd/id/issues/1)，工程候選與核准需分開記錄。
