# AI-0｜Starry 30～50 款 App 未來組合與上線節奏（v0.1 候選）

> 依 2026-10-28《Starry 生態系共用技術基座與 AI 開發前交接包 v1.0》整理。**原文要求的 30～50 款是長期容量目標，不是已批准 50 款 App；以下八類、權重與 Canary 數量為 AI-0 建議，非業主已核准產品或市場證據。**

**總控**：[技術基座 #156](https://github.com/starry-phd/id/issues/156)；[本規劃 #158](https://github.com/starry-phd/id/issues/158)；[技術候選 ADR PR #157](https://github.com/starry-phd/id/pull/157)。

## 一、候選方向：8 種產品類別，不是 8 個正式產品

| 類別 | 具差異的核心用戶流程 | 可評估的商業模式 | 主要風險 |
|---|---|---|---|
| 個人生產力 | 離線記錄、目標與週期回顧 | 買斷、月／年訂閱 | 資料匯出／離線正確性 |
| 短課程與學習工具 | 課程、練習、學習進度 | 買斷、月／年訂閱、選配廣告 | 授權內容／原創教學 |
| 特定領域內容媒體 | 內容檢索、進度、合法觀看／收聽 | 訂閱、買斷、選配廣告 | 影音著作權及媒體成本 |
| 生活習慣工具 | 可控資料記錄與非醫療性趨勢 | 買斷、月／年訂閱 | 健康聲稱與敏感資料 |
| 現場專業作業 | 離線工作、佐證與同步 | 買斷、月／年訂閱 | 商用資料與位置／照片授權 |
| 創作者工具 | 授權素材編輯及匯出 | 買斷、月／年訂閱 | 版權與 AI 使用成本 |
| 實用參考工具 | 可信查詢／計算及離線參考 | 買斷、選配廣告、去廣告 | 內容正確性及更新 |
| 社群活動工具 | 發現、參與、審核與回饋 | 訂閱、選配廣告 | UGC 審核／申訴／兒少安全 |

各類別都必須有獨特用戶、獨特核心流程和相對既有 Starry App 的具體差異。若只是換主題、名稱、顏色或其他 App 的複製版本，應先考慮併入現有產品，不能為湊 50 款而上架模板。

## 二、證據式優先排序（AI-0 建議，預設無分數）

| 指標 | 權重 | 需真證據 |
|---|---:|---|
| problem_evidence | 20 | 真實訪談／用戶問題與重複需求 |
| substantive_differentiation | 20 | 對既有 Starry App 的實質差異；避免換皮 |
| monetization_fit | 15 | 買斷／訂閱／廣告與可信付費驗證 |
| feasibility | 15 | 雙端原生 PoC、內容及 SDK 能力 |
| compliance_and_privacy | 15 | 內容權利、隱私、兒少／適用政策 |
| unit_economics | 10 | 維護、Cloudflare/EAS/Store/SDK／內容費用 |
| shared_sdk_reuse | 5 | 利用共用技術但不共享別的 App 業務邏輯 |

使用 0～5 的具體證據評分，總分為各分數乘權重再除 5 的總和（總權重 100）。**沒有訪談、PoC、實際支出或營利證據就標 PENDING；不可自行填假分或猜測營收。** 高分無法取代安全、版權、商店政策或發布人授權。

## 三、分階段路線：僅 P0 三款小型技術測試 App 數量來自原文件

1. **P0**：先建立 3 款小型測試 App（至少兩類產品），以不同情境驗證 SDK58/RN088 候選、Expo Router、RevenueCat/AdMob/Sentry iOS+Android development build、Hono→OpenAPI→client、pnpm/Turbo、AppFactory 與 Store SKU 跨 App 隔離。可用非商業假產品，但 **沒有真 native/sandbox run 就不能宣稱 PoC 已過**。
2. **P1**：候選 1～2 款實際有差異、需求與合法素材的 Canary（這個數量是 AI-0 的方案，不是原文發布承諾）；驗真用戶、退款/恢復購買/去廣告/廣告隱私與成本。
3. **P2**：Canary 有真結果後按 App 分批處理，不一次放 30～50 款。版本共用 SDK 先測 Canary 才可 rollout；按需要跑 affected CI、相容性 native build 與回退。
4. **P3**：維護未來 30～50 款容量，當 App 數接近 25、CI p95 >25 分鐘、原生相依／權限／移交需要出現時，啟動平台 Repo 分群 ADR，非自動搬遷或拆分。

## 四、商業模式、權益與不變規則

- 單 App 可個別選買斷、月訂閱、年訂閱、廣告、去廣告；**不是每一款都要裝全套**。Rewarded 只在真正需要時開。各 App 獨立 Bundle/package/SKU/Ad IDs/商店內容、版本與核准。
- 去廣告的正式規則是可信且有效的永久去廣告權益，或當期有效且包含去廣告的訂閱；退款/撤銷、寬限等由 AI-2 單一權威決定，不相信客戶端 purchased 旗標。
- 免費 Starry Battery 永久不能賣；各 App 只接 AI-3 的版本化 BatteryClient，不得直接寫中央 D1。AuthClient 及 BillingClient 類同，各領域由專責唯一 Owner 管理。
- 30～50 App 不保證都會通過商店審核。Apple 重複/模板 App 風險、商店個資申報、帳號刪除、授權素材與適用 ATT/UMP 需在**每款**發版時查核。
- 成本必須包含 EAS/Expo/GitHub/Cloudflare/RevenueCat/AdMob/Store/媒體或 AI 授權、監控維運，區分估算與真帳單；沒有預算與供應商許可就不實際付費。

## 五、每 App 上線前不可跳過的證據閘

| Gate | 必備證據 | 初始狀態 |
|---|---|---|
| PRODUCT | 目標群體／核心流程差異／Apple 4.3 模板風險 | PENDING |
| INTAKE | App ID、平台／Bundle Package、Repo、商店帳號、責任人 | PENDING |
| CONTRACT | Auth/Battery/Billing Client版本、brand/app/env唯一權威 | PENDING |
| NATIVE | iOS/Android真Development Build與插件相容證據 | PENDING |
| MONETIZATION | 正式商品／Ad ID、sandbox退款/恢復/去廣告、UMP/ATT適用性 | PENDING |
| PRIVACY | 版權/資料用途保留刪除/商店隱私聲明/兒少風險 | PENDING |
| BUDGET | SDK、EAS、Workers/D1/R2/Queues成本上限及當次授權 | PENDING |
| RELEASE | 真Commit、CI、Build/OS、審核、回退、當次發布批准 | PENDING |

最低可稽核：App ID、測試日、commit、CI run、Expo/RN/原生 SDK 版本、iOS/Android build IDs、裝置＋OS、商店 sandbox、真實結果與失敗、審核人/當次授權。Source 的第十節 App 開案卡另製成可複製模板。

## 六、組織分工，不與四 Owner 現在的工作重疊

- **AI-0**：只管理未來產品組合／需求實證／排序／產品差異／上架 Gate；技術需求關聯 #156。
- **AI-1**：AuthClient；**AI-2**：BillingClient/Store 來源；**AI-3**：免費 BatteryClient/稽核；**AI-4**：Expo/OpenAPI/App Factory/AdProvider/DevOps。需要新技術接口時在 GitHub Issue 標依賴，不搶寫其他領域。
- 目前 central ID 主線和所有發行 Gate 不因未來 App 規劃解除。既有具名且交由其他 AI 的 App 不在本五組的實作範圍。舊成果/商店狀態不被偽稱已上線。

## 七、下一步

先收真正完整的開案卡與市場／成本證據，AI-0 才替每款候選評分、提出批准/不批准/合併建議。所有討論與 Draft PR 在 #158／#156 完成 GitHub-only 交接；不要求使用者轉貼給四位。
