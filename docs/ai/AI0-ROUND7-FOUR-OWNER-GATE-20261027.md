# AI-0｜R7 四組新版決議同版本離線整合（DRAFT，2026-10-27）

> **狀態：待本 Draft PR 的 GitHub Actions／固定 SHA 實際驗證；所有正式 Release Gate G00–G10 均 BLOCKED。**
> 本分支不合併 main、不部署、不調用真 OAuth/Store/Cloudflare D1/Queues/EAS/Secrets，也不開通任何付費服務。H-Global 工程保持暫停。

## 基礎與業主決議

- 起始基準：[AI-0 R6 四組整合 #59](https://github.com/starry-phd/id/pull/59)，固定 `0c71ef5f7164a4b55cc9f5c987cfc013f8cf6904`。
- 最新業主核准／待決分類：[AI-0 集中決議 Q89～Q125](https://github.com/starry-phd/id/issues/1#issuecomment-6425664451)；AI-0 [未定產品名稱的多 App 布局](https://github.com/starry-phd/id/issues/1#issuecomment-6425924820)。
- 第一波 P01～P10 只需建立已核准的受保護接口／事件／監控與安全最小管理操作；第二波管理中心不啟動。首款 App 名稱／SKU／商店正式上架仍未核准。

## 四組固定來源（保留原 Owner Draft、不變更上游 PR）

| Owner | PR | GitHub 固定 HEAD | 內含主體差異 |
|---|---|---|---|
| AI-1 / Auth | [#62](https://github.com/starry-phd/id/pull/62) | `61b1c79da1774a61cd29865e3072676cbffb0491` | 18+ 風險 Gate、Starry 全 Session 刪帳撤權、受保護最高管理員候選；8 檔 |
| AI-2 / Billing | [#60](https://github.com/starry-phd/id/pull/60) | `499fba3500cc5ccfeb4681d71a396d656fe3e22f` | 跨 App / 跨平台 SKU 受限、退款／商店事件安全判定、混合 IAP ADR；3 檔 |
| AI-3 / Battery | [#63](https://github.com/starry-phd/id/pull/63) | `74ef0076e4ab553fc002662cc114f621d427f102` | 永久免費／贈送／兩次有界透支／3 分鐘 reserve／清償／撤權的離線狀態與 SQLite 候選；6 檔 |
| AI-4 / Expo/API | [#61](https://github.com/starry-phd/id/pull/61) | `81918d87dbb46cb4865b5425bd1fbd79e1f7f00e` | ID 底座獨立分期、18+ UI 預檢、Worker fail-close、SDK preview；9 檔 |

上述共有 **26 個 Owner 原始檔案**以相同內容納入獨立 AI-0 R7 整合分支（其中既有檔案更新為 AI-2 ADR、AI-3 專責 CI workflow；其餘皆新增）。**這是檔案內容層級整合，不是把四個 PR 正式合併到 main。**

## AI-0 新增安全整合測試

- `packages/integration/test/round7-all-owners-gate.test.mjs` 對同一個 checkout 的四位 Owner 實際模組做負測／release-flag 合約測試。
- 即使 identity/battery/billing 均通過離線測試，`RELEASE_AUTHORIZED=false`、`COMMERCE_PUBLISHABLE=false`、`LIVE_BATTERY_WRITES_ENABLED=false` 仍維持。
- Starry / H-Global 隔離；共用 Starry ID **不是單獨商店 App**；首波不放廣告，跨品牌 API 預設禁止。
- 客戶端偽造最高管理員 principal，不得因此取得免費 Battery 調整權限。
- 免費 Battery 不得作為 Billing SKU 出售；未獲真實後端註冊發放核驗，不可發放免費額度。
- 只用 GitHub Actions、Node、TypeScript、SQLite :memory:、Wrangler dry-run 等 **離線工具**。需以最新 R7 PR 同 SHA 真 CI 查證；上游四個綠燈不能替代本分支整合驗收。

## AI-0 判定標準與殘餘阻塞

**可判定：** 同一固定 R7 Head 的 GitHub Actions 全數 completed/success、無測試 skip、typecheck／lint、全部 owner + integration Node tests、SQLite memory、SSOT 來源格式與 Release preflight fail-closed。測試成功只能得到 **OFFLINE SAME-CHECKOUT VERIFIED**，絕不等於正式 OAuth、D1、Store、EAS 或 Production 驗收。

**仍被阻擋：**
1. 128 項原始 `source_id` 與已核准 Q 決議／候選／衝突／驗收證據逐項對照仍未完成；G00 BLOCKED。原始 `docs/requirements/registry.v0.json` 只有 seed，不能據此宣稱全數通過。
2. Q104 一般不可自行撤回跨系同意／解綁是有法遵爭點的產品意向，正式跨品牌串接目前停用，需合法例外而不得剝奪個資撤回權利。
3. Q119 刪帳後防重領電池的跨帳戶去重證據，須有合法個資保留依據；舊 `s_user_id` 不可復活；新註冊不自動恢復餘額。
4. 電池 X/Y 具體值、免費任務費率／會員欠額上限／可信 Task 成功權威、D1 原子性／真 Queue 的安全驗證仍待 Gate；所有系統給付仍 default OFF。
5. 真 Apple/Google OAuth/TLS/JWKS、真 Apple Store / Play API、後端 IAP 供應商、退款權威查核、正式 D1/Queue、EAS 原生裝置／商店上架、監控／成本、復原演練皆未完成。
6. 無已核准首款 Starry 正式 App／SKU／商店上市地區名單；首款登入底座是共用服務，不是擅自建立單獨 Starry ID 商店 App。

**AI-0 後續：** 只根據此整合 PR 最新 HEAD 的 CI 與原始 source-level 追溯矩陣判定是否可進入下一個**離線**開發階段；正式 G00～G10 持續阻擋。四位 AI 後續若要寫程式，必須從本次整合固定 Head 或等價的已核可分支產生隔離 Draft，避免基線飄移。

**嚴禁未經業主授權合併 main、部署 Preview/Staging/Production、修改正式 D1／Secrets、進行真實內購／任何付費、EAS Build/Update，或啟用 H-Global。**
