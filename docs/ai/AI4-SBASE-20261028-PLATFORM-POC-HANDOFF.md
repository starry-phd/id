# AI-4｜SBASE-20261028 共用 App 工程基座候選 PoC／介面與回退交接

**狀態：已編碼的 PRIVATE/OFFLINE 候選契約；原生／商店／廣告/Hono PoC 均 PENDING。** 來源：[SBASE 主控 Issue #156](https://github.com/starry-phd/id/issues/156)、[AI-4 #5 派工 #6459894909](https://github.com/starry-phd/id/issues/5#issuecomment-6459894909)、[業主候選 Google Docs](https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ)。本輪範圍**只限 Starry 共用平台的公開可稽核候選程式，不含特定外部 App 製作/搬遷**。既有 ID/Auth/免費 Battery/Billing 所有權、G00–G10 以及中央 R23 release 關鍵路徑不變。

## 0. 固定源碼基準與反破壞差異

- 已經驗過的中央四 Owner R21 離線 Draft **[#148](https://github.com/starry-phd/id/pull/148)** HEAD `fbd5c03156da700b68c7b5bceb65269cb7c900ec`（Node1087、SQLite304、3/3 CI success），**不是 Production**。選它作為本 AI-4 候選 Branch parent，以**保留仍在 Draft 的中央 Auth/Battery/Billing 及測試成果**；不改 main。
- 公開主線 **`main` `8be31efb3dfba66755f297b315593e33cdacfe39`** 不含 R21 四組整合；AI-0 SBASE 自己的 Doc Draft [#157](https://github.com/starry-phd/id/pull/157) 是在 main 上，不能偷當成中央 R21 已 merged。**AI-0 整合時必須重新調和 branch provenance**，不得把本 PR 的 base 當自動 main 合併許可。
- 實際目前 `apps/mobile/package.json`：**Expo `~54.0.20`、React Native `0.81.5`、Expo Router `~6.0.13`**；根專案 npm workspaces 並有 npm scripts；`apps/api/src/index.ts` 目前只有真 `GET /v1/health` / fail-closed error routes。無可驗真 Hono/Zod server 或 pnpm/Turbo 基座；**不可改原 lockfile**。
- 候選文件的 Expo SDK 58 / RN 0.88 / pnpm+Turbo / Hono+Zod+OpenAPI 3.1 / RevenueCat / react-native-google-mobile-ads / Sentry 目前都 **PENDING REAL POC**，不是本 PR 安裝/實測/驗證。SDK 選型與官方版本、發佈期限需重新查當期 upstream；沒有用 npm install/EAS/Store/Cloudflare/API Key。

## 1. 本輪真新增程式、端口與安全負測

- `apps/api/src/sbase-20261028-app-manifest-factory.ts`：`validateSbaseManifest`、`checkSbaseFleet`、`planSbaseAppFactory`、`inspectSbaseClientPorts`、`decideSbaseAdPlaceholder`、`inspectExistingHealthContract`。**僅提供型別、安全檢查、Factory 計畫；沒有寫任何新 App 檔案、原生 build 或任何付費 API**。
- `apps/api/test/sbase-20261028-app-manifest-factory.test.mjs`：使用真 Node 測試與真已存在的 API `handleRequest(GET /v1/health)` 驗證；涵蓋真安全負測：跨品牌/Production、Getter injection、malicious secret fields、未核准 SKU/Provider/廣告/安全開關、App ID/Bundle/package/url scheme 碰撞、50 App 超額、unknown Auth/Battery/Billing 失效隔離、不可信去廣告及假付款成功、未授權發布。
- 候選 Manifest 顯式只准 `brandId=starry`、`development|staging`、平台身份唯一、三 Owner SDK **版本插槽**；Billing/Ads Provider 一律 `disabled`、所有發行/金流/廣告/native SDK toggles 只能 false。當前在 **公開** `starry-phd/id` 存非敏感抽象測試；Factory 只返回 `NEW_PRIVATE_REPO_PENDING`，**絕不自動把未來 50 款私有商業 App 放進公開中央 repo**。
- `inspectSbaseClientPorts` **只**讀取各 Owner 注入的版本化候選 `readStatus()`，無中央 ID D1/Battery/Billing DB、無 Auth publisher、無可驗真「已登入」「可用電池」「已付費權益」。本地 mock 正回應也只能 `review_only`，downstream 需要 DEV-D/A/B 官方合同/簽章才可開。
- `decideSbaseAdPlaceholder` 只做**安全規則原型**。買斷或訂閱含去廣告優先於顯示廣告，訂閱過期但永久買斷仍不得恢復廣告；所有 mock 輸入一律 `can_request_ad=false`，既無 UMP/ATT、真商店 verified receipt、合法 Consent，也沒有 AdMob SDK。**Battery 永久免費不可販售或透過購買發放**。
- `inspectExistingHealthContract` 真呼叫舊 Worker `handleRequest`，只證明當前 `/v1/health` 的離線行為。Hono routing+Zod schema+OpenAPI codegen/openapi-fetch 的**實際新依賴 PoC 尚未完成**；不存在的 Auth/Admin endpoints 不得宣稱已部署。

## 2. ADR 候選、成本、驗證與回退

| 決議 | 已知與比較 | 現況 / 待驗 |
|---|---|---|
| D-01 Expo 58/RN0.88 | 現 Expo54/RN0.81.5；新原生 RevenueCat/AdMob/Sentry 插件和 Expo Router 可能需原生配置 | **待隔離 private 3-App PoC**；iOS+Android development builds，裝置/OS/SDK版本、native plugin compat log；不改中央 Lockfile |
| D-02 pnpm/Turbo vs 分群 Repo | 單一私有 Monorepo易共用/affected CI；核心 SDK + 獨立App可分隔權限/外包/移交，但 package publishing 成本更高 | **建議先獨立私有 PoC repo，候選 monorepo**；需測 Metro/autolinking、pnpm isolated installs、CI p95、Expo/EAS；25 Apps / 25min p95 僅評估訊號，非自動拆庫 |
| D-03 RevenueCat vs 自建 | RC Webhook/訂閱/退款支援可能節省維運；自建需驗 Apple/Google server transaction/漏訊/訂閱生命週期 | DEV-B 擁有 Store 單一權威；需正式 sandbox 和價格/成本核定；本次 BillingClient 只有禁用插槽 |
| D-04 AdMob、UMP/ATT | Banner/Interstitial 候選；Rewarded App 選配；每 App Ad Unit ID、頻率、合規地區分開 | disabled AdProvider 只回 no request；真裝置 AdMob+UMP/ATT + no-ads Store 正確性 **PENDING** |
| D-05 RN Web | 每 App 自選 Web；後台獨立 React+TS，不把管理員程式放 Consumer App | 需與舊 DEV-I 人工決定，無路由生成 |
| D-06 成本 | EAS builds/updates、GitHub CI、RC tracked revenue、Cloudflare Workers/D1/R2/Queues、第三方驗證/AdMob；估算與真帳單分開 | **沒有帳單/價格查證或額度授權**；不能解鎖付費或觸發 native build |
| D-07 跨 App 權益 | App 各有 SKU、Bundle/Package、Store Server 限制，且帳號團隊/移交影響 | **首版獨立 App** 候選；跨 App 商業互通不實作 |
| D-08 UI | StyleSheet+Design Tokens 候選，NativeWind/Tamagui 可比性能/維護成本 | 待真機/設計審閱，不建立 50 款同貌 App |
| API stack | 現有真 Workers TS /health + OpenAPI 草案 vs Hono/Zod/OpenAPI 3.1 + openapi-typescript/fetch | 已有 baseline direct handler/health offline assertion；**Hono/Zod/codegen POC pending**；須在私有隔離 PoC 加裝候選依賴並比較相同 HTTP response、不重寫中央 Auth |

**PnP/Turbo 可控 CI 候選**：只在未來私有 PoC 測 affected graph、去重 workflow concurrency（同 commit SHA 只跑一次重測）、core SDK canary 2 款再擴散；中央 `starry-phd/id` 既有 GitHub Actions/workflow 不變。避免破壞中央 release Gates 或因 push + pull_request 雙觸發重複全量 CI。

**回退**：本輪只在 `ai4/sbase-20261028-*` 新分支新增獨立 3 個 files；取消/關閉 Draft 即不影響 main 或中央 R21 #148，且沒有遠端資料或服務可回退。任何未來真正升級都應建立隔離 private 原型＋ADR 先驗，再分批 Canary＋保護 CI 回退。

## 3. 跨 Owner API 和剩餘阻塞

- **AI-1 DEV-D**：AuthClient 所需 `appId, brandId, environment, scopes, session/revocation`、線上/Guest/離線安全降級與版本契約，正式 Auth Session 只能 AI-1 核准、不得從 SDK 改中央 DB。
- **AI-2 DEV-B**：BillingClient per-App product key/SKU、付款/訂閱/restore/退款、去廣告的**官方 Store Server/Provider 權威**；不得把本機 `purchased` 或 AppA SKU 當 AppB 權益。
- **AI-3 DEV-A/H**：BatteryClient **免費且不可販售**、版本化安全查詢、owner event/稽核/失效隔離；尚未批准餘額/扣抵等舊規則不臆造。
- **AI-0**：批准或拒絕 D-01..08、Repo 是否公私拆分、Release/Cost Gate，決定未來何時在新私有 Repo 進行真 iOS/Android 3-App native+Store/Ads/Hono PoC；本輪不能拿一次 offline TypeScript CI 當具備上述實測。
- 新基座**不能取代 R23 Starry ID 正式部署必需的 D1/Queue/安全/法律/獨立 anti-PITR 真證據**，中央正式 `G00–G10` **11/11 BLOCKED**、`P05/PUBLISHABLE=false`。R22 針對外部特定 App 的舊 PR 是歷史，不准重新匯入中央。

**適用 P01～P10：** P01 候選 AppId/品牌/環境不可重複；P02 只有舊 /health 真路由+未完成 Hono/codegen；P03/P04 管理後台/Auth 仍由各 Owner 安全契約；P05/P06 業務事件/Audit 只由領域 Owner 發出；P07/P08 未實測監控/成本；P09 GitHub PR/SHA/CI 證據真實記錄、EAS/Cloudflare deploy 無；P10 disabled flags＋可回退、安全設定只供 review。

**絕對禁止**：main merge、Cloudflare Preview/Staging/Production/EAS Build/Update/Submit、真 D1/R2/Queue/Secrets/OAuth/Store、AdMob/RevenueCat 生效、付費 API、跨品牌 H-Global 任何實作；不保存不必要個資，不擅自將公開 Repo private 或建立真公開產品。
