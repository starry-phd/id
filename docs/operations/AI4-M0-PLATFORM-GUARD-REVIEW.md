# AI-4 M0｜UP-07／08／09 修補與回歸（Draft PR #267）

AI-0 退件理由：https://github.com/starry-phd/id/pull/267#issuecomment-6511154780
AI-1 M1 平行核心：https://github.com/starry-phd/id/pull/266

## UP-07：歷史記錄與後續合法原件修補
W2 20 + W3 10 原 Git blob SHA 保留在歷史 manifest，且兩份 manifest 本身的 Git blob SHA 受保護；後續 src/schema/test 的現行內容不再永遠等於舊版本。程式准入由受審 PR、精準路徑規則及 CI 決定；允許 M1 修補既有原件與新 src/schema/tests/docs，拒絕秘密、未知 workflow、部署腳本及任意目錄。新增正例與偽造歷史 provenance 負例。

原能力 manifest 位置保留，內部升級到 schema v2：逐路由 method/path/auth/environments/enabled/aliases/bindings。live 僅 GET /v1/health；新增 GET /v1/starry-id/members/me 候選為 staging-only、auth=starry-session、enabled=false、aliases=[]、binding STARRY_SESSION_DB type=injected-test-port/provisioned=false。這是合法 inert staging 契約，不是已建立 Cloudflare D1 綁定、真登入或正式 API。apps/api/src/inert-staging-scope.ts 是 test-only 候選，不被正式 Worker import。任何不明環境、alias、method、query、token/cookie 都不能取得會員資料。

## UP-08：結構化解析與 workflow
parseRestrictedWrangler 對 TOML 與合法 JSON 格式（屬 Wrangler JSONC 的嚴格子集）做 table/key/value/schema 對照。未知巢狀 env、preview/production、real D1/Queue、變更名、重複鍵／表、JSON 替代格式新增綁定 fail closed。此受限解析器不聲稱支援所有 JSONC 註解或複雜 TOML 語法，新語法必須受審擴充。

inspectWorkflow 使用 lockfile 既有 yaml 2.9.1 結構化 YAML/JSON 解析；核對 event、contents:read、required validation 依賴、npm 測試指令、CI 不可讀 secrets 或部署、無新增 deploy job，Production 僅手動 dispatch 一個 hard-denial job (exit 1)。真正式 Gate 11/11 blocked，沒有變更或解除外部 Cloudflare Builds 安全設定。

## UP-09 Workers Vitest 差異
詳細 ADR：docs/operations/AI4-M0-UP09-WORKERS-TESTING-ADR.md。
Cloudflare 官方 2026-08-19 更新推薦 @cloudflare/vitest-plugin 1.x (Vitest >=4.1)，已取代舊 @cloudflare/vitest-pool-workers。現有 esbuild+Miniflare5 在本地 workerd isolate HTTP 實測是有效試點，但不是 Vitest plugin，尚未測真 D1/Queue/remote/issuer，ADR 明確保持缺口 OPEN，避免冒稱官方 parity。本輪不新增會變更 lockfile 大型依賴的新測試框架；待 M1 真 Auth 核心進入受審 Worker 以後再驗證官方 plugin 版本及獨立 CI。

## 交付與回滾
僅平台 guard、CI、schema、inert source、測試與文件；正式 Worker/SDK/OpenAPI 不變。npm ci (Node22) → typecheck/lint/npm test/strict Auth+W3/Expo config/Wrangler staging dry-run/local workerd/release:blocked/promotion:verify；實際驗收只看最後 exact SHA 的 CI 日誌。對應 P01/P02/P09/P10，G08/G10 仍 blocked，11 個正式 Gate 不變。未合可關閉 Draft；如合併後需 AI0 審查 revert merge SHA 並重驗 CI；Git revert 不會改動外部 Builds。沒有 Cloudflare 寫入、真資源、費用、正式會員部署、H-Global/Echo。
