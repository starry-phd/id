# API 回應範例（給 App 離線測試）

每個檔案是一個端點的真實回應範例。CI 的 `test/fixtures.test.mjs` 會實際呼叫 API，比對範例與真實回應的欄位與型別，不一致時無法合併，所以這些範例會跟著程式更新。值（ID、時間、Token）是假的。

| 檔案 | 請求 | 狀態 |
|---|---|---|
| `apps-config.200.json` | `GET /v1/apps/echo/config` | 200 |
| `auth-nonce.200.json` | `POST /v1/auth/nonce` | 200 |
| `auth-sign-in.200.json` | `POST /v1/auth/apple`、`/v1/auth/google` | 200 |
| `auth-refresh.200.json` | `POST /v1/auth/refresh` | 200 |
| `me.200.json` | `GET /v1/me` | 200 |
| `me-profile.200.json` | `PATCH /v1/me/profile` | 200 |
| `me-profile.409.json` | `PATCH /v1/me/profile`（If-Match 版本過舊） | 409 |
| `me-identities.409.json` | `POST /v1/me/identities/apple`（這個登入方式已另外建立帳號，可合併） | 409 |
| `me-identities.201.json` | 同上，帶 `merge_other_account: true` | 201 |
| `me-entitlements.200.json` | `GET /v1/me/entitlements` | 200 |
| `me-battery.200.json` | `GET /v1/me/battery` | 200 |
| `me-deletion.202.json` | `POST /v1/me/deletion` | 202 |
| `error.json` | 所有錯誤的格式（例：未登入 401） | 4xx／5xx |

## 錯誤碼

所有錯誤都是 `{"error": {"code", "message", "request_id"}}`；`message` 給開發者看，畫面文字請依 `code` 自行決定。

| HTTP | code | App 應該做什麼 |
|---|---|---|
| 400 | `BAD_REQUEST` | 輸入有誤；個人資料的 `message` 以欄位名稱開頭（例如 `phone: …`） |
| 400 | `APP_NOT_FOUND` | app_id 錯誤 |
| 400 | `CONSENT_VERSION_MISMATCH` | 同意的條款版本不是目前版本：重新讀取 `GET /v1/me` 的 `consent` |
| 401 | `UNAUTHORIZED` | Access Token 無效或過期：用 refresh 換發，失敗再回登入畫面 |
| 401 | `INVALID_TOKEN`、`INVALID_NONCE` | Apple／Google 登入驗證失敗或逾時：重新取 nonce 再登入 |
| 401 | `INVALID_REFRESH`、`REFRESH_REUSED` | 回到登入畫面（`REFRESH_REUSED` 代表整個 Session 已撤銷） |
| 403 | `ACCOUNT_SUSPENDED` | 顯示停權說明並登出 |
| 403 | `ACCOUNT_PENDING_DELETION` | 顯示刪除倒數與撤回按鈕（`DELETE /v1/me/deletion`） |
| 403 | `APP_UNAVAILABLE` | App 被暫停或停用：顯示維護中 |
| 403 | `REAUTH_REQUIRED` | 敏感操作需要重新登入 |
| 409 | `VERSION_CONFLICT` | 個人資料已在別處更新：用回應中的 `profile` 重新顯示 |
| 409 | `IDENTITY_IN_USE` | 見 `me-identities.409.json`：`mergeable` 為 true 時詢問會員是否合併 |
| 409 | `PROVIDER_ALREADY_LINKED` | 已綁定另一個同類型的登入 |
| 409 | `CONFLICT` | 狀態已改變，重新整理 |
| 428 | `PRECONDITION_REQUIRED` | `PATCH /v1/me/profile` 缺少 If-Match |
| 429 | `RATE_LIMITED` | 依 `retry-after` 標頭稍後重試 |
| 503 | `AUTH_NOT_CONFIGURED`、`PROVIDER_NOT_CONFIGURED`、`SERVICE_UNAVAILABLE` | 服務設定中：需要授權的操作一律拒絕（fail closed） |
