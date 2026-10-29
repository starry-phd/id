# AI-4 UP-09｜Workers Test Harness 決策（M0 Draft #267）

狀態：**Trial accepted for M0 only; Workers Vitest parity remains OPEN**。本 ADR 明確區分平台真實執行和官方建議整合，不能拿 Node test 數量抵銷真 staging/remote Gate。

## 現行 Cloudflare 官方版本查證（2026-10-30）
Cloudflare 官方 2026-08-19 公告：原 @cloudflare/vitest-pool-workers 已改由 **@cloudflare/vitest-plugin v1**，並支援 Vitest >=4.1；舊 pool-workers 命名已不是最新主路徑。來源：
- https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/
- https://developers.cloudflare.com/workers/testing/vitest-integration/
- https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/
- https://developers.cloudflare.com/workers/testing/

官方建議：Vitest Worker plugin 的測試檔在 workerd 執行，提供 cloudflare:workers 的 env 與 cloudflare:test，並可以覆蓋 D1/Queue/多 Worker，隔離 test-file storage；integration harness createTestHarness() 可針對實際建置物跨 Worker HTTP 路由進行測試。

## 本 PR 為何保留既有 Miniflare 5 / esbuild（差異與審查條件）
- 現有確定 lockfile Wrangler 4、Miniflare **5.20261019.2-beta** 和 esbuild；利用已在 #267 同 SHA CI 通過的 Miniflare5 官方 workers[].config.manifest API 將**原 Worker** 打包後本地 workerd HTTP dispatch。此試點驗到 Staging health / env 拒絕 / 未公開路由 / headers 與 405；不是只直接調用 Node handleRequest。
- 它**不是 @cloudflare/vitest-plugin**，未整合 test-file storage 隔離、cloudflare:test、真 D1/Queue/多 Worker 或官方 Vite plugin；對 M1 issuer→D1 authority、跨請求交易與封鎖競態的測試證明不足。Miniflare 本機不是惡意程式安全沙盒，也不是 Cloudflare Remote 測試。
- 直接在本 M0 guard PR 安裝 Vitest/plugin 會更新已經受 W3 source promotion 規範的 npm 鎖檔、搭配新版 Vite/TS 整合、擴張主切片及 CI 維護面。本次選擇**明確保留既有本機試點且將官方 parity 標記 OPEN**，不聲稱 UP-09 已完成官方 Vitest integration。
- 真正的 M1 Worker Auth/D1 E2E 正例在 AI-1 #266 真正產生受控 HTTP 服務/本機 port 後，應使用官方 @cloudflare/vitest-plugin >=1.0、Vitest >=4.1 的隔離 integration test，或在另一個經審查 PR 以 createTestHarness() 驗證 Worker 相互調用；確定版本相容後新增 CI 必須 fail-closed 並保留現有 hard-denial。
- **本輪可交付 UP-09 出口**：實際 local workerd Miniflare HTTP 測試、差異與未覆蓋範圍、可復現 pinned Node 22 / npm ci 指令、未來正式測試升級條件。不把此 ADR 當成已驗證新的線上環境。

安全範圍：未接入真 binding、secrets、remote D1、OIDC/商店、未改 Production workflow 或 Cloudflare；G00–G10 全 blocked。若改為 Vitest，必須有必要的實際來源、依賴、型別、tests 同 SHA CI，不可以只補名詞。
