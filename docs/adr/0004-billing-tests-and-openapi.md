# ADR 0004：Billing 投影、單元測試與 OpenAPI 時程

日期：2026-11-03　狀態：採用

## 1. RevenueCat Webhook 不用 Queue

規格 S-BIL-04 寫「先回 200 再交給 Queue 處理」。實作改為：先以 event_id 寫入 `rc_events`（去重）並回 200，回應後以 `waitUntil` 更新投影；每日 Cron 補處理失敗或遺漏的事件（最多 10 次）。效果相同（RevenueCat 不需等待、事件不會遺失、重送不重複），且不需要建立 Queue 資源。流量成長或需要更即時的重試時再改用 Queues。

App 端仍以 RevenueCat SDK 為即時來源；投影表供後端判斷。永久買斷記在 `lifetime_product_id`，訂閱到期或訂閱退款不會撤銷它（S-BIL-05）。每日與 RevenueCat 對帳見 ADR 0005。

## 2. 單元測試

整合測試照 ADR 0001：打包後在 workerd（Miniflare）＋D1 執行。另外新增 `test/unit/`：領域邏輯（刪帳、角色、加綁、Apple 撤銷、帳單投影、推播、客服、頭像、網頁 Session）寫成不依賴 Hono 的模組，以 `node:sqlite` 實作的 D1 替身（`test/support/sqlite-d1.mjs`）跑真正的 migration 與 SQL，用 tsx 執行。好處是快、可以在沒有 workerd 的環境驗證 SQL 與規則；HTTP 層仍由整合測試覆蓋。

## 3. OpenAPI（S-PLT-03／S-PLT-04）

重建當晚沒有 CI，延到 Repo 建立後完成（2026-11-03）：

- `/v1` 與 `/.well-known/jwks.json` 以 `@hono/zod-openapi` 宣告，文件由 `npm run openapi` 產生到 `openapi/starry-id.v1.json`（OpenAPI 3.1）。CI 確認提交的文件與程式一致，PR 再以 oasdiff 檢查破壞性變更。
- 請求驗證失敗維持平台錯誤格式（400 `BAD_REQUEST`）；JSON 端點收到非 JSON 內容改回 415 `UNSUPPORTED_MEDIA_TYPE`。
- Apple 與 Google 各自一條登入（與加綁）路由，所以其他供應商仍是 404。
- Admin Lite `/admin/api` 顯示產生的文件，只有 Owner／Admin 可看（S-PLT-04）。
