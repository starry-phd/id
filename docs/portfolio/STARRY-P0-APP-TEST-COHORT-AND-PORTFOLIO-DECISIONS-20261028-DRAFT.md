# AI-0｜Starry P0 三款技術測試 App 與未來產品組合「可執行的規劃」v0.2（2026-10-28）

> **全篇皆為 AI-0 候選工作方案，不是已核准 App 清單或實際開發/上架。** 不修改既有 [v0.1 八類/100 分權重/開案卡](https://github.com/starry-phd/id/pull/163)；該三份原始檔已在 [SBASE 五組同版 #164](https://github.com/starry-phd/id/pull/164) 的 18 個 source blobs 中完整保留。本文件只把先前抽象的「三款 PoC」變成**角色、測試矩陣、負責人與證據門檻**，再提出需求實證採樣辦法。Master：[Issue #158](https://github.com/starry-phd/id/issues/158)、[SBASE #156](https://github.com/starry-phd/id/issues/156)。

## 1. P0 的三款是「合成測試外殼」，不是三款待上架產品

| 技術測試 App | 不含商業 App 名稱的角色 | 需辨識的技術/業務差異 | 安全預設與不宣稱 |
| --- | --- | --- | --- |
| **P0-A：離線參考／小工具** | 實用參考（ARC07）；公開的合成靜態資料＋純本機搜尋／計算 | iOS+Android 最小 Expo Router、原生 build、離線/升級、App ID/包名隔離、匿名/Guest；可選 Banner 的**測試設計** | 無真人資料、無付費／廣告真 ID、無網路權益；AdMock 一律不載廣告 |
| **P0-B：學習進度型** | 短課程（ARC02）；自製佔位課程與假進度 | Guest→已核准 AuthClient 的帳號連線設計、Session revoke、登入失敗隔離、月／年訂閱＋恢復/到期/退款的 sandbox 測試案例 | 未有真 issuer/Store 前全部 fail-closed，不能解鎖內容或稱訂閱成功；內容授權另審 |
| **P0-C：創作匯出型** | 創作者工具（ARC06）；合成素材編輯與本機匯出 | 第三組原生插件/檔案與權限、一次買斷／去廣告優先權、App-specific SKU/Ad Unit、不同 SDK 版本回退 | 無真使用者素材／敏感檔、沒有真 IAP/AdMob/ATT/UMP 時不允許付費或廣告上線 |

P0-A/B/C 是**至少三種差異情境**的候選選擇，不賦予商店名稱、package、SKU、Ad ID、公開網域或 IP。三款足以涵蓋 Guest vs Account、離線 vs 網路依賴、單次買斷 vs 訂閱、廣告 vs 去廣告、檔案權限。上架型產品是否真有需求需 **P1 另行選案**，P0 測試結果不得當市場證據。

### 前置決策順序（不能以便捷當批准）

1. **P0-PRE：D-02 Repo/ACL** — 由 [D-02 候選 ADR](../operations/AI0-SBASE-D02-MULTI-APP-REPO-TOPOLOGY-ADR-20261028-DRAFT.md) 選 A/B/C；**目前未選定、不可建立 private Repo**。必須確認每 App 可獨立權限/發布/回退、既有 Public `id` 不會暴露私有資源。
2. **P0-ENV：獨立測試身分與成本** — 書面確認允許建立的 3 個合成 App、不可觸碰的正式 Cloudflare Worker `id-starry`、GitHub/AppStore/Play/EAS/AdMob/RevenueCat 等帳號與當期費用上限。未知為 UNKNOWN，不默許付費。
3. **P0-TECH：原生插件 PoC** — **只在另行核准的隔離 repo** 實測 Expo58/RN0.88、Sentry、Hono/Zod/OpenAPI codegen、pnpm/Turbo；先核對候選相容性，再雙端 Development Build。現有 Expo54/RN0.81.5 不升級。
4. **P0-SERVICE：授權來源與隔離** — AI-1 AuthClient 只能從真核准 issuer/Session 決定私權；AI-2 Store 唯一權益權威；AI-3 永久免費 Battery 唯讀安全契約；AI-4 Manifest/Factory 不冒稱能真正寫 App/Store。所有假端口／mock 均不得給權益、扣款、廣告或部署授權。
5. **P0-GATE：實際測試報告** — 記 commit SHA、對應 PR、依賴鎖檔、Native build ID、iOS/Android 裝置/OS、真結果、預期失敗案例、SDK rollback/Factory package collision、CI、復原證據；缺其中對應項即 `NOT_VERIFIED`。

## 2. 每個 P0 都必須過的驗收矩陣（尚未執行）

| Gate | P0-A | P0-B | P0-C | 權威與目前狀態 |
| --- | --- | --- | --- | --- |
| 每 App 獨立 Bundle/applicationId／env／scope | 必要 | 必要 | 必要 | AI-4 + AI-0：`PENDING` |
| 兩端真 Development Build/原生插件/故障回退 | 必要 | 必要 | 必要 | AI-4：`PENDING` |
| 中央 Auth Guest／錯誤／撤銷後安全拒絕 | Guest | Session 測試 | Guest/選配 | AI-1 + AI-4；中央 G02/G03 `BLOCKED` |
| 唯一 Store 原始交易權威／退款／恢復 | 不適用或 fail-closed | 訂閱 sandbox | 一次買斷 sandbox | AI-2；真 sandbox `NOT_STARTED` |
| AdMob consent／UMP/ATT 適用判定及去廣告 | 廣告候選 | 禁止未核准廣告 | 廣告/去廣告衝突測試 | AI-2 + AI-4；真廣告 `NOT_STARTED` |
| Battery 永久免費／跨 App 禁止購買 | 必要 | 必要 | 必要 | AI-3；offline 候選已在 #164，但 live `BLOCKED` |
| 跨 App 偷用 session/SKU/Ad ID/私有 D1 | 拒絕 | 拒絕 | 拒絕 | Owner 安全測試 `PENDING` |
| P05、Privacy、資料撤銷、最小 log／成本 | 必要 | 必要 | 必要 | AI-0+Owner：正式 Gate `BLOCKED` |

**證據層級不得混用**：`designed`、`code_exists`、`verified_offline`、`verified_native`、`verified_live_sandbox`、`owner_approved` 六層獨立記。#164 的 1,151 Node / 304 SQLite memory 是共享客戶端**離線**整合證據；不是上述 P0 原生、Store 或上線完成。

## 3. 下一批產品方向：12 個「需求假設」，不是 12 款已決定 App

沿用原 [八類型候選](https://github.com/starry-phd/id/blob/11a0c9443ec34c60bcbcf77e1231e4b0f5381e04/docs/portfolio/starry-app-portfolio-candidates.v0.json) 的 ARC ID。以下功能是 AI-0 新提案；不能用「熱門」「肯定可賺錢」取代真研究。

| 假設 ID | 所屬類別 | 有別於普通同類產品的「待驗問題」 | 初步可比較的收費型態 | 最大待查證事項 |
| --- | --- | --- | --- | --- |
| H01 | ARC07 參考工具 | 可離線查閱的專業術語速查、來源版本標註 | 買斷/無廣告 | 可靠資料授權、更新責任 |
| H02 | ARC07 參考工具 | 可重複使用的領域計算器與單位記錄 | 買斷/選配廣告 | 公式與法遵正確性 |
| H03 | ARC01 生產力 | 離線工作清單與每週回顧可匯出 | 買斷/訂閱 | 是否真需要持續訂閱 |
| H04 | ARC01 生產力 | 個人專案階段追蹤與跨裝置保守同步 | 訂閱候選 | 真需求、同步成本、刪帳 |
| H05 | ARC02 學習 | 針對一個可量測技能的微練習＋回顧 | 買斷/訂閱 | 教材著作權與學習實效 |
| H06 | ARC02 學習 | 專業術語情境測驗（原創題庫） | 買斷 | 題庫維護/侵權風險 |
| H07 | ARC03 內容媒體 | 原創合法內容的離線閱讀／播放進度 | 訂閱/買斷 | 授權鏈、頻寬與儲存 |
| H08 | ARC04 生活習慣 | 非醫療性日常行為記錄及自我檢視 | 買斷/訂閱候選 | 敏感資料和健康聲稱 |
| H09 | ARC05 現場作業 | 無網路清單/檢查與匯出報告 | 買斷/訂閱候選 | 商用資料權限、裝置可靠性 |
| H10 | ARC06 創作者 | 本機素材範本與無上傳匯出 | 買斷/訂閱候選 | 素材授權/原生權限 |
| H11 | ARC08 社群活動 | 小型活動報名與會後回饋流程 | 訂閱候選 | UGC、身分/隱私/申訴 |
| H12 | ARC05 現場作業 | 專業服務工單佐證與審核歷程 | 訂閱候選 | 企業資料保留、成本及法遵 |

**此表不排序、不給分、不立案，不與已交其他對話的具名 App 競爭實作。** 如果產品與既有 Starry App 的真核心流程高度重疊，優先考慮併入原 App 或取消，而不是換皮衝 50 款。H01–H12 的商業型態是 **hypothesis**，商店提供者、平台審查與正式 SKU 全未核准。

## 4. 如何做證據排名，而不自造市場數字

每份 H01–H12 候選先建立 [一頁開案卡](https://github.com/starry-phd/id/blob/11a0c9443ec34c60bcbcf77e1231e4/docs/portfolio/STARRY-NEW-APP-INTAKE-CARD-v0.md)，只允許在有來源鏈接時評分。沿用 [現有 100 分 scorecard](https://github.com/starry-phd/id/blob/11a0c9443ec34c60bcbcf77e1231e4/docs/portfolio/starry-app-portfolio-candidates.v0.json) 的七項權重，**不重寫權重**。

| 先補的資料 | 建議最小蒐證方式（非已執行） | 未有資料時 |
| --- | --- | --- |
| 有沒有反覆出現的特定痛點 | 目標使用者訪談、可匿名公開統計或可證明的需求回饋 | `PENDING`，不評 problem_evidence |
| 是否已有重複 App 或被 Apple 視為模板 | 既有 App 流程差異矩陣、商店當期審核指南及相似產品比對 | `PENDING`，不評 differentiation |
| 有沒有付費意願而非只有廣告設想 | 明確告知價格/功能的願付費意願測試、合法可得競品價格/評價 | `PENDING`，不填收益預測 |
| 原生 SDK／內容／伺服器能不能供應 | P0 真 Build、獨立權限、App-specific SKU／撤權負測、內容權利證明 | `PENDING`，不評 feasibility |
| 每款的可變成本與維護 | SDK/Store/EAS/CI/Cloudflare 供應商當期費率、真帳單與預算上限 | `UNKNOWN`，不填虛構成本 |
| 資料保護及未成年人風險 | 資料清冊、明確保留/刪除規則、兒少/醫療/UGC 適用性審查 | `BLOCKED`，不能發布 |

排序前先過 **否決性條件**（不合法資料使用、欠授權內容、與既有 App 重複到可能換皮、無法安全分離 Secrets/Store、無法證實退款/刪除）再談分數。**不以收入預測、推薦順序或空白分數當成已市場驗證。**

## 5. 具體分批決策流程

- **P0：技術穩定性**。先完成 D-02/隔離資源核准，測 3 款合成 P0。全部 Native/Live Sandbox/P05/Privacy 欠證據時，狀態 `NOT_STARTED`。未經授權不建立 repo/Store/EAS/paid service。
- **P1：選出具有真用戶差異的 1–2 款 Canary（數量為 AI-0 建議）**。只有具市場證據、版權、單 App 商店身份、法律資料政策、成本預算、真裝置/退款/去廣告測試才可請業主核准。沒有候選達標可以是 **0 款**。
- **P2：小批量重複**。每批只放已各自達成 PRODUCT/INTAKE/CONTRACT/NATIVE/MONETIZATION/PRIVACY/BUDGET/RELEASE 全部 Gate 的 App，先完成 SDK 在 canary 的相容與 rollback，再增加下一群。批次大小由真風險/維護容量定，不是預先下達上架 KPI。
- **P3：容量治理**。維持到 30～50 款的策略上限觀察，不代表必須開發或上架達標；依 GitHub CI p95、原生插件版本、App 移交/IP、線上維護人數和單 App 帳單實測，才核准拆群/重整。數量和觸發門檻由 D-02 審查再決定。

### AI-0 跨四 Owner 接口（只列證據需求，不在此重派施工）

| Owner | 需要回報給 AI-0 的既有工作證據 | AI-0 本案不改 |
| --- | --- | --- |
| AI-1 | versioned AuthClient/issuer/session revoke、per App scope、Guest、中央 G02/G03 缺口 | Auth DB/session/OIDC source |
| AI-2 | BillingClient per-app SKU、訂閱/買斷/退款/恢復/去廣告唯一 Store authority、D-03/D-07 | Store/Billing DB 與真商品 |
| AI-3 | 免費 BatteryClient、Queue/Audit/P05 provenance、權限/撤權/獨立回復 | Battery D1、已核准的免費規則 |
| AI-4 | App Manifest、Expo/RN 原生版本與插件、OpenAPI SDK、Factory 實際能力、Cloudflare Preview RCA | AppFactory/Expo/Workers/Workflow 程式 |

**正式中央 [R23 Release readiness](https://github.com/starry-phd/id/blob/11a0c9443ec34c60bcbcf77e1231e4/docs/release-readiness/release-readiness.v0.json) 仍 G00–G10 11/11 BLOCKED。** 沒有 P0 原生/真 Store/真 Cloudflare 驗證，也沒有 Production、真 D1、EAS、Secrets、付費服務、H-Global 或外部具名 App 開發。下一步僅在 [#158](https://github.com/starry-phd/id/issues/158) 收集真產品需求，再考慮由業主決策 D-02 與實際 PoC 權限。
