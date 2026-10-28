# AI-0｜30～50 款 Starry App：實際產品立案與反重複上架稽核 v0.3（2026-10-28）

> **狀態：PORTFOLIO_TRIAGE_CANDIDATE_ONLY。** [Issue #158](https://github.com/starry-phd/id/issues/158) 是正式規劃入口。本輪接續 [AI-0 未來 App #170](https://github.com/starry-phd/id/pull/170) 及已同版完成離線整合的 [#171](https://github.com/starry-phd/id/pull/171)，**不重寫八個候選類別、不重建 12 個 H01–H12 假設、不觸 AI-1～AI-4 Auth/Billing/Battery/Expo/Factory、不實作任何具名外部 App**。

## 1. 為什麼需要「一款一案」與先排除換皮

以 2026-10-28 查閱官方規範為準：

- **Apple App Review Guidelines 4.3(a)/(b)**：禁止提交僅換 Bundle IDs 的同款或大量近似產品；須以實質不同或改良的體驗證明價值。[官方規範](https://developer.apple.com/app-store/review/guidelines/)（頁面 Last Updated: 2026-10-16）。
- **Apple 4.2、4.2.6**：只有網站外殼／未具 App 功能、商業化模板生成 App 有審核限制；不代表透過共用 Expo Factory 就自動不合規，但每款**實際內容與體驗**必須獨特，不能把「工程模組共用」錯解為「每個商店 App 只是換皮」。[官方規範](https://developer.apple.com/app-store/review/guidelines/)。
- **Google Play Spam／Repetitive Content**：近似內容/體驗、大量重複功能可能被拒；小規模內容可考慮整合成一款。[Google Play 官方](https://support.google.com/googleplay/android-developer/answer/9899034?hl=en)。
- **Google Play 帳號刪除**：若 App 可建立帳號，須規劃 App 內與網路上的刪帳路徑及相關資料處理；適用保留例外仍需合法告知。[Google Play 官方](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)。

這些是**官方平台政策背景**；「要用哪一種開案評分、何時判定應合併」是 **AI-0 的治理建議**，不是平台已批准某一款 App，也不是法律意見。每次送審前需重新檢查當期政策。

## 2. 本輪新交付：真正可執行的「讀取式候選開案檢查器」

| 交付檔 | 實際用途 |
| --- | --- |
| `docs/portfolio/ai0-app-intake-evidence-gate.mjs` | 純函式 `reviewStarryAppIntake`；輸入原 8 類/100 分權重、12 假設及候選資料、既有 App 清冊，輸出理由碼、欠缺證據、建議合併、待人工審查 |
| `docs/portfolio/ai0-app-intake-cli.mjs` | Node22 本地只讀命令；讀取指定 JSON + 既有證據資料；不能查網路、不能操作 GitHub/Cloudflare/商店 |
| `docs/portfolio/ai0-app-intake-example-H01-unapproved.json` | **空白且全部權限為 false** 的 H01 合成開案格式，`score_0_to_5=null`、`evidence_urls=[]`，不得當真產品證據 |
| `packages/integration/test/ai0-app-intake-evidence-gate.test.mjs` | 12 項 Node 安全負測、反同質化與冒充權限案例，納入既有四 Owner 同版 Offline CI 的 `packages/integration/test/*.test.mjs` |

**立即可在此版本執行的本地命令**（GitHub PR 中檔案存在，並非本文宣稱已在正式環境實際運作）：

```bash
node docs/portfolio/ai0-app-intake-cli.mjs --input docs/portfolio/ai0-app-intake-example-H01-unapproved.json
```

預期讀取式回傳：`status=NEEDS_EVIDENCE`、`proposed_score_unverified=null`、`may_implement_app=false`、`may_use_store=false`、`may_deploy=false`、`ready_to_rank=false`。**CLI 的 exit code 0 只表示檢查執行，不代表可以開發／收費／上架／部署**。

若有一份人工核對過的既有 App registry，可加 `--registry <本機JSON檔>` 輔助檢查重複 `app_id`／`unique_product_flow_key`。但本 CLI **永遠不自行將 Registry 標成 verified**：即使提供清冊，仍需獨立人員確認內容完整且最新，避免假清冊冒充「差異化已核准」。此檔案不得放會員個資、供應商秘密、商店真私密憑證。**公共 Repo 僅收匿名／非敏感證據連結**。

## 3. 新 App 的證據如何分類

既有 [八類/100 分評分](./starry-app-portfolio-candidates.v0.json) 七項權重完全不變：problem 20、differentiation 20、monetization 15、feasibility 15、privacy 15、unit economics 10、SDK reuse 5。新工具只替 **未有明確證據／URL 的分數判定不完整**，不替使用者編出需求、下載、競品市占、願付費率、營收或 AWS/Cloudflare/Expo 真費率。

- **REJECT_INVALID_INTAKE**：跨 H-Global／Starry 權限、假批准/漏設安全 false、錯類別、竄改 100 分權重等。不可進入產品投資討論流程。
- **RECOMMEND_MERGE_OR_RENAME**：在已核對清冊中已見同一 `app_id` 或 `unique_product_flow_key`，優先讓產品負責人判斷合併到現有 App；**字串不同不等於真差異**，仍需人工比較流程。
- **NEEDS_EVIDENCE**：缺合法素材、產品差異、Apple/Google 政策分析、個資/刪帳、商店開發者帳號分配、維護責任、預算成本、既有 App 完整清冊或七項評分所需具體證據。
- **READY_FOR_HUMAN_EVIDENCE_REVIEW**：只在呼叫者**已獨立證實現有 App Registry**且所有必要欄位/URL/分數都有提交時才可能出現，**仍不是市場驗證、不是業主批准、不是 P0 技術原生 PoC，也不是可發版**；工具不下載、驗證 URL 內容。已提交分數只標 `proposed_score_unverified`，`ready_to_rank=false`。

**不變安全契約**：所有狀態下 `is_product_approved/may_implement_app/may_create_repo/may_build_native/may_use_store/may_serve_ads/may_deploy/ready_to_rank` 必為 **false**。不能由 App Intake 讀取器替代中央正式 G00～G10、各平台真 Store/合規/Native 或業主當次發布授權。免費 Starry Battery 永遠不得變 SKU。

## 4. 從 12 個假設走向真正第一批上線產品的關鍵路徑

| 時段 | 實際交付（只在有真證據後標完成） | 產品去留決議 |
| --- | --- | --- |
| 第 0 階段：問題定義 | 對已有人力負責的產品，逐款交匿名痛點/獨特流程、競品相似性、更新責任及至少一個真需求來源；原 H01～H12 目前**都未核准** | 缺證據則暫緩；同核心流程則優先合併 |
| 第 1 階段：可持續性 | 買斷/訂閱/廣告是否符合使用頻率；來源可追溯的費率與變動成本；真 Store 權益唯一性、取消/退款；內容版權/隱私資料保留 | 不具經濟合理性或權利者 **NO-GO** |
| 第 2 階段：工程可用性 | D-02 private repo/權限決策、3 個合成 P0 iOS+Android 真原生驗證、Factory/SDK跨 App 隔離、App-specific Bundle/SKU/AdUnit | P0 只證明工程能力，**不等於三款商業 App 立案** |
| 第 3 階段：Canary | 從有證據且無重複風險的候選中選 0～2 款（AI-0 建議非業主承諾），分別核准責任、真商店審核/資料政策、上線後維護與回退 | 任何一個 Gate 未通過，一律不可上架 |
| 第 4 階段：組合擴大 | 以實際維護容量/費用/SDK 升級影響評估批次，不為了 30～50 指標每周發換皮 App | 30～50 僅是可擴充容量，不是發行 KPI |

## 5. 不與四位 AI 的本輪工作重疊

**AI-0** 專管 App 選案、差異/反重複上架、已有人管理的 App 清冊來源、治理提案及業主審查。**AI-1** 唯一 Auth/Session Writer、**AI-2** 唯一 Store/Billing 權益、**AI-3** 永久免費 Battery/稽核、**AI-4** Expo/Factory/Preview。此工具只讀 Docs JSON，未修改其任一原始 TypeScript／SQLite／Wrangler／workflow／manifest/SDK。四位各自另輪 GitHub 交接需由 AI-0 後續整合，不得搶先聲稱已部署或新 PR 自動通過。

中央 [#171](https://github.com/starry-phd/id/pull/171) 已有前輪同 SHA GitHub 離線整合成功；本輪新 commit **必須重新驗 CI**，不能沿用舊 SHA。正式中央 **G00～G10 11/11 BLOCKED**、P05/PUBLISHABLE=false，無 main merge、真 Store/D1/Cloudflare/Preview/EAS/付費或 H-Global 工作。
