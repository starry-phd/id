# AI-4 M0｜平台 Promotion Guard、Readiness Freeze 與 Workerd 隔離證據

- Owner / handoff: AI-4 Issue #5 / AI-0 Issue #1.
- 基線：main SHA 22f1b303ae5c90ba28caac614a82efd79fd570d9，GOV PR #265 已合併。
- 準據：main AGENTS.md、docs/ai/HANDOFF-PROTOCOL.md、docs/ai/OPTIMIZED-DEVELOPMENT.md，AI-0 #5 M0 工作令 #6499159139。
- 本檔僅是已提交原始碼的審查說明，**不是正式環境、G08 或發行核准證據**。

## 三個獨立受審判斷

1. **未授權發布永久拒絕（release）**：official readiness Git blob 0ea2e40692fb2e9f7e0c282ac1ece91ad2c740ba 及 production workflow Git blob 900f49b561a4fc2a89ed054d3e37e2b2c20e549b 各自凍結。11/11 Gate blocked、evidence 空、release_authorization=false、deployment_automation=false。Production workflow 保留人工 dispatch 硬拒絕 exit 1，無部署憑證／部署指令；不准額外 workflow／取消 Required validation。日後即使 capability 或原始碼通過審查，也不得藉此解鎖發布。
2. **來源追溯（provenance）**：維持 W2 20 + W3 10 原始 Git blob 校驗、完整 Git tracked-path allowlist 與來源 manifest。本輪不動 Auth／Billing／AI3 原檔，僅增加 M0 平台需要的 5 個路徑及既有 package.json／CI／guard 接線。
3. **切片能力（capability）**：docs/operations/AI4-M0-PLATFORM-CAPABILITIES.v1.json 明確批准 Worker、OpenAPI、SDK 原 Git blob，只允許 /v1/health、Auth=false、Production=false。AI-1 M1 Auth route 需後續獨立主 PR、安全與契約審查，不能由能力 manifest 自動授權 staging／production。

上述三層由 scripts/promotion/m0-guard-policy.mjs 實作，經現有 scripts/promotion/verify-curated-release.mjs 執行。原 Worker／OpenAPI／SDK／Release／tracked-path guard 不移除，避免審閱前放寬；AI-0 日後若核准 M1 演進，需以另一 PR 有意識地移轉舊 health-only 限制，不得觸動 release fence。

## Wrangler 結構化設定與負例

parseRestrictedWrangler 建立明確的 TOML 表、鍵、型別與值；它是受審簡單設定的限制性 parser，並非通用 TOML parser。唯一表集合是根層、vars、env.staging 與 env.staging.vars；所有欄位必須完整且唯一。未知表、巢狀 env、preview／production、D1、Queues、R2、array-of-tables、dotted key、重複 table、Worker name/main/compatibility_date/scope 意外變更均拒絕。未來需新增 TOML 特性時提交專門的 parser/schema 審閱變更。

## 實際 Workers runtime

apps/api/test/workerd-runtime.test.mjs 以現有 lockfile 內的 esbuild 打包真實 apps/api/src/index.ts，並透過 Miniflare 的 workerd isolate dispatch HTTP，不是 Node 直接呼叫 handleRequest。驗證 staging health 200 與 no-store/nosniff、production/preview 503、錯 App 403、Auth／會員／session／Billing／Admin／跨品牌 404、非 GET health 405。全部是本機 isolate，**沒有 remote Cloudflare Worker/D1/Queues、真 OAuth issuer 或商店/裝置測試**。

可重現環境：GitHub Actions ubuntu-latest、Node 22、npm ci --no-audit --no-fund、npm test、npm run api:runtime、npm run api:check（僅 Wrangler dry-run）、npm run release:blocked、npm run promotion:verify。Root npm test 與獨立 api:runtime 有重複測試，不計成不同獨立功能。以本 PR 最終同 SHA 的 Actions job log、Required validation 為真正驗收憑證，不引用先前 W3/GOV 作為新成功證據。

## Gate / 環境 / 回滾

P01/P02/P09/P10 是本輪相關的結構化 App/env、能力合約、CI 發布證據與設定版本；G08/G10 仍 blocked，G00–G10 11/11 blocked。GitHub ruleset、Production Environment、Cloudflare Builds 停用保護與外部資源完全不動。正式會員服務未部署，未新增 secrets、付費項目、D1、Queue 或新 Worker；H-Global/Echo 不參與。

未合併前回滾：AI-0 關閉 Draft PR，main 不變。若日後由 AI-0 合併，只能審查後 revert 對應 merge commit 並重驗真實 CI；**Git revert 不會自動改變 Cloudflare 外部 Builds 安全設定**。後續真正 Auth 接線由 AI-1 主責，AI-4 僅平台與契約審查，不重複其會員路由實作。
