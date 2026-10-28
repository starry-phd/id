# AI-0｜D-02 多 App Repository／權限／發版拓樸 ADR（2026-10-28 候選）

> **狀態：PROPOSED / OWNER_DECISION_REQUIRED / NOT_IMPLEMENTED。** 本 ADR 僅補足既有 [#158 產品組合](https://github.com/starry-phd/id/issues/158) 與 [#156 SBASE](https://github.com/starry-phd/id/issues/156) 的 **D-02 決策缺口**；**不新建 Repo、不變更 Repo visibility、無新部署或付費**。可追溯的四組離線候選整合以 [#164](https://github.com/starry-phd/id/pull/164) HEAD `11a0c9443ec34c60bcbcf77e1231e4b0f5381e04` 為基準。

## 1. 明確問題與已驗事實

- GitHub 已驗的 Repo 是 **`starry-phd/id`，Public**，管理者 `yukidu`；`starry.phd` 為業主日常稱呼時應核對實際 GitHub owner slug，不依口語猜測遠端。
- `id` 是中央會員、Auth/Billing/免費 Battery 契約與 R23 發布 Gate 的工程來源；主線目前不同於 #164 候選整合。不可把正在平行開發的 AI-1～AI-4 原始碼拉進新的私有產品 Repo 造成第二份唯一 Writer。
- SBASE v1.0 列出 **private pnpm/Turborepo 多 App monorepo** 或 **SDK Repo + 個別/分群 App Repo**；都只是候選，現有 npm workspaces/Expo54/RN0.81.5 不得自行升級。
- 30～50 款是長期**容量目標**；沒有 30～50 款已核准產品、商店 Bundle ID、SKU、App 廣告帳號或市場證據。Public `id` 不承載未公開 App 產品原始碼、真用戶資料、Secrets 或私有商品設定。

## 2. 三個可選架構（均未獲批准）

| 方案 | 收納方式 | 優勢 | 風險／代價 |
| --- | --- | --- | --- |
| A：所有未來 App 集中一個 private monorepo | 所有 App + 共用 UI/SDK + 工廠共庫 | 原始碼一次版本協作、受影響 CI 易集中 | 30～50 App 可能出現單一 ACL／原生相依／密鑰／發布連鎖風險；團隊或產品轉移難分割 |
| B：Private SDK Repo + 每 App 獨立 private Repo | SDK 單一來源、每 App 獨立 CI/Secrets/Store | App 權限、單體發布及未來獨立移交最清楚 | 版本升級與 CI/依賴協調成本最高，易維護碎片化 |
| **C：Private 平台／SDK Repo + 按業務/原生相容性分群的 private App Repo（建議先 PoC）** | 公開 `id` 維持獨立；私有 SDK 釋出版本契約；每群組少量相容 App、必要時獨立 Repo | 減少全體 blast radius，同時集中重複技術與受影響 CI | 仍需建立跨 Repo 版本/發布/ACL/稽核流程；群組界線需要實證 |

**AI-0 的暫行推薦：方案 C 作為待驗假設，不是業主正式決議。** 如果首批 App 的私有程式管理/成本/權限需求不適合分群，就回到 B；不因 30～50 目標而預設建立 50 個 Repo。最小導入先只在**隔離且已授權的 3 個 P0 合成測試 App**證實策略。

## 3. 責任邊界與資料治理（任何方案都要守）

1. **`starry-phd/id` 不因 App 拓樸而改公開性或重建。** Starry 中央 Auth、Session、會員資料、Billing 真 Store 權益、免費 Battery 的資料庫唯一 Writer 保持各自原 owner。新 App 僅藉版本化 AuthClient/BillingClient/BatteryClient/OpenAPI 使用，不直接讀寫中央 D1。
2. 每款 App 的 `app_id / brand_id / environment / bundle ID / applicationId / Store App / SKU / Ad Unit / signing key` 各自登記。任何跨 App 權益共享皆預設**禁止**，除非 D-07 另由業主審核並經合法驗證；Battery 永久免費、不得商品化。
3. Repo/群組以 **產品 IP／存取人員、原生 Expo 插件相容、發布節奏、獨立移交權、成本可歸屬性**決定，而不是只按 UI 顏色/產品名字。不同商店帳號/法遵風險時優先拆 Repo。
4. Private 不等於能亂放敏感資料：Secrets 僅在最小授權的 CI/environment/管理服務中，禁止 commit、PR 訊息、人工樣本與 build logs。每 App 的 Production 簽章/商店/DB/environment 均獨立管理與審批。
5. **版本化而非互相 copy/paste SDK**：SDK API / TypeScript 契約/相容區間/變更日誌/回退 lock，跨 App 依賴透過受控 package 發布或最小 read-only source 依賴選型；實際 package registry/價格仍 UNKNOWN／需核准。
6. **發布隔離**：每 App 的 Build/Env/CI/SDK Upgrade 審查與 rollback 獨立；SDK 更新先受影響的 P0/Canary，再批次上線。Preview 不能使用已配置正式 Worker `id-starry`；Cloudflare #164 [失敗 RCA #165](https://github.com/starry-phd/id/pull/165) 另案處理。
7. 目前 H-Global 停止施工；Starry／H-Global Auth/D1/Secrets/管理員與付款都獨立。既有已交其他 AI 的具名 App 不納入本次實作，只可在產品組合層標示避免重複。

## 4. D-02 最小決策試驗（依序、不得擅自實施）

| Gate | 在開始前需取得 | 可驗收證據 | 仍未達成 |
| --- | --- | --- | --- |
| D02-00 需求 | 業主同意 Repo visibility、權限擁有人與未來移交方式 | 書面 scope、允許建立的確切 Repo／team、是否收費、禁止正式部署規則 | **PENDING** |
| D02-01 離線設計 | 不需新雲端資源 | 3 款 P0 App 獨立包名/SDK版本/CI矩陣、分群 vs 每 App 隔離衝突案例、受影響 Build 設計 | **PROPOSAL_ONLY** |
| D02-02 私有測試工程 | 獲正式允許建立指定 private Repo，核實帳號/方案額度 | 實際 ACL review、pull-only SDK、三 App 不互見機密、回退/Repo移交演練 | **NOT_STARTED** |
| D02-03 真原生／SDK | D-01/D-03/D-04 與商店/成本另案批准 | iOS+Android 獨立 Dev Build、SDK 升級/回退、跨 App SKU/Ad ID/Session 突破負測 | **NOT_STARTED** |
| D02-04 擴張批准 | 真 CI p95、維護/費用/人員權限實測 | 方案 A/B/C 依實際試驗簽署選型；每款 App 獨立 Store Gate | **BLOCKED** |

### D-02 人工裁決欄（尚未填入）

- 選擇 A/B/C：**UNDECIDED**
- 核准的 Repo/群組名稱及 private scope：**NONE**
- GitHub 權限分工／安全審核人：**PENDING**
- 使用 private packages / GitHub Actions 的估算、實際帳單和費用上限：**UNKNOWN**
- SDK 與正式中央 Service 版本相容規則、D-07 跨 App 訂閱：**PENDING**
- 業主核准連結／日期：**NONE**

## 5. AI-0 本輪完成界線與交接

- 本檔是新的 **D-02 選型決策提案**；既有 [產品分類與評分 #163](https://github.com/starry-phd/id/pull/163) 已在 #164 保留，絕不重新複製；[P0 三款 Test App 合成矩陣](../portfolio/STARRY-P0-APP-TEST-COHORT-AND-PORTFOLIO-DECISIONS-20261028-DRAFT.md) 是本 ADR 的非執行性設計補充。
- **AI-0** 維護 D-02/R23 決策及跨 App 發布 Gate；AI-1/2/3/4 各自的 Auth/Billing/Battery/Expo/AppFactory 工作**不中斷、不搶寫**。日後得到正式權限/插件證據再由 AI-0 評審，不以寫了此 ADR 宣稱 PoC 完成。
- 本輪不用建立新 GitHub Repo、Cloudflare、EAS、Store、Secrets 或付費服務。正式中央 G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false。
