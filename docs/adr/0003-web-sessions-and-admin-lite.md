# ADR 0003：Web 帳號中心與 Admin Lite

日期：2026-11-03　狀態：採用

## 決定

1. **同一個 Worker、同一個網域**：帳號中心、客服表單、Admin Lite 與 `/v1` API 都由 `starry-id` 提供，網址 `https://id.starry.phd`（業主指定）。網頁以 Hono 在伺服器端產生 HTML，不另建前端專案（規格 S-ADM-01）。
2. **Cookie Session 存在 sessions 表**：保留 app_id `account`，Cookie 為 `__Host-starry_session`（HttpOnly、Secure、SameSite=Lax、Path=/），內容 `<session_id>.<secret>`，只存 SHA-256。閒置 7 天或滿 30 天失效。登出所有裝置、停權與刪帳以既有的 `session_version` 立即生效。App 不能用 `account` 登入，網頁 Cookie 也不能當 Refresh Token。
3. **CSRF**：所有網頁寫入要求 `Origin` 等於本站，加上 SameSite=Lax（規格「檢查 Origin 以防 CSRF」）。
4. **CSP**：每個網頁回應帶 nonce 的 CSP，只允許本站、Google Identity Services、Sign in with Apple JS 與 Turnstile。全站 COOP 設為 `same-origin-allow-popups`、Referrer-Policy 為 `strict-origin-when-cross-origin`，因為 Google／Apple 的網頁登入使用彈出視窗並檢查來源。
5. **角色與近期登入**：每個 Admin 請求都在後端查角色。停權、復權、App 狀態與角色變更原本要求 10 分鐘內登入；2026-11-07 業主決定取消，Admin Lite 只做角色檢查（帳號加綁與合併仍要求 10 分鐘內登入）。Support 只能查看與處理客服單。
6. **Owner 來源**：`OWNER_USER_IDS` Secret，或一次性 Owner 認領（`OWNER_CLAIM_CODE`，已有 Owner 後失效）。這樣不必在任何頁面顯示會員 ID（規格 S-ID-03）。
7. **App 狀態開關**：`config/apps.json` 是預設值；Admin 可在 D1 覆寫為 paused／killed，各 isolate 快取 30 秒。

## 後果

- 網頁登入需要業主提供 Google Web Client ID 與 Apple Services ID，未設定前帳號中心顯示「網頁登入尚未開放」。
- 客服回覆以 Email 進行；寄信功能（Email Routing）尚未設定，客服單在 Admin Lite 查看。
