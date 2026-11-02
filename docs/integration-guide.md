# Starry App 串接說明

給每款 Starry App（首款：繁星回聲 Echo）的開發者。API 網址：`https://id.starry.phd`（staging 為 `starry-id-staging` 的 workers.dev 網址）。所有錯誤回應格式為 `{"error": {"code", "message", "request_id"}}`。

## 1. 啟動

App 啟動時呼叫 `GET /v1/apps/{app_id}/config`：

- `status` 不是 `active`：`paused` 顯示維護中，`killed` 停止使用並引導更新或說明。
- App 版本低於 `min_version`：要求更新。
- Starry ID 無法連線時，不需登入的畫面照常使用；需要授權、購買或 Battery 的操作一律拒絕（規格 S-PLT-09）。

## 2. 登入（Apple／Google 原生）

1. `POST /v1/auth/nonce` `{"app_id": "echo"}` → `{"nonce", "expires_in"}`。
2. 把 nonce 交給原生 SDK：
   - iOS Apple：`expo-apple-authentication`，`nonce` 參數直接傳原值（SDK 會自行雜湊，後端兩種都接受）；同時取得 `authorizationCode`。
   - Android Apple：使用網頁流程（Services ID），nonce 同上。
   - Google：Google Sign-In 原生套件，設定 `nonce`。
3. `POST /v1/auth/{apple|google}`：

   ```json
   { "app_id": "echo", "id_token": "…", "nonce": "…", "authorization_code": "（僅 Apple，選填但建議附上）", "device_label": "iPhone 16" }
   ```

   回應：`access_token`（15 分鐘）、`refresh_token`（30 天）、`user.user_id`、`user.status`、`user.is_new`、`user.deletion_purge_at`、`consent_required`。
4. 兩個 Token 都存在 `expo-secure-store`，不放 AsyncStorage。
5. `consent_required` 為 true：顯示條款與隱私權政策（連到 `/terms`、`/privacy`），同意後 `POST /v1/me/consents` `{"terms_version", "privacy_version"}`（版本取自 `GET /v1/me` 的 `consent`）。
6. `user.status` 為 `pending_deletion`：顯示「帳號將於 … 刪除」與撤回按鈕（`DELETE /v1/me/deletion`）；撤回前其他 API 會回 403 `ACCOUNT_PENDING_DELETION`。

## 3. 呼叫 API 與換發

- 每個請求帶 `Authorization: Bearer <access_token>`。
- 收到 401：用 `POST /v1/auth/refresh` `{"refresh_token"}` 換發，**新的 refresh_token 要覆蓋舊的**；舊的再用一次會撤銷整個 Session（`REFRESH_REUSED`），此時回到登入畫面。
- 同一時間只讓一個請求執行 refresh（加鎖），避免並發換發被誤判為重用。
- 403 `ACCOUNT_SUSPENDED`：顯示停權說明並登出。429 `RATE_LIMITED`：依 `retry-after` 稍後重試。

## 4. 帳號功能（App 內必須提供）

| 功能 | API |
|---|---|
| 個人資料 | `GET /v1/me`；`PATCH /v1/me/profile` 帶 `If-Match: "<version>"`，409 時以回應中的最新資料提示使用者 |
| 頭像 | App 裁切成正方形、壓縮到 256 KB 內，`PUT /v1/me/avatar`（`Content-Type: image/webp`）；顯示用 `profile.avatar_url`（1 小時有效，需要時重新取 `/v1/me`）；沒有頭像時顯示名稱第一個字 |
| 加綁登入方式 | 重新取 nonce 並以另一個供應商登入取得 ID Token，`POST /v1/me/identities/{provider}` |
| 登出 | 先 `DELETE /v1/me/push-tokens`，再 `POST /v1/auth/logout`，最後 RevenueCat `logOut()` |
| 登出所有裝置 | `POST /v1/auth/logout-all` |
| 刪除帳號（Apple 與 Google 皆要求 App 內入口） | 說明 7 天撤回期與「不會自動取消訂閱」，確認後 `POST /v1/me/deletion` `{"confirm": true}`，成功後清除本機 Token |

網頁版入口（Google Play 要求的 App 外刪除網址）：`https://id.starry.phd/account/delete`。

## 5. 購買（RevenueCat）

- 未登入點購買：先導向登入，登入完成回到原畫面；取消登入不得開始交易（S-BIL-03）。
- 登入成功後 `Purchases.logIn(user.user_id)`；登出時 `Purchases.logOut()`。
- App 內以 RevenueCat SDK 的 CustomerInfo 為即時來源；App 的後端需要判斷權益時呼叫 `GET /v1/me/entitlements`（只回本 App 的權益）。
- 付費畫面需清楚顯示價格、週期、條款連結與「恢復購買」按鈕。

## 6. 推播（需要時）

- 取得 Expo Push Token 後 `PUT /v1/me/push-tokens` `{"token": "ExponentPushToken[…]", "platform": "ios"|"android"}`。
- 分類開關：`GET`／`PUT /v1/me/notification-preferences` `{"categories": {"reminders": false}}`；Android 通知頻道 ID 使用相同的分類名稱。

## 7. App 後端驗證會員

App 自己的後端（如需要）以 `GET /.well-known/jwks.json` 的公鑰驗證 Access Token（ES256）：`iss` 為 `starry-id:production`（staging 為 `starry-id:staging`）、`aud` 為 `starry`、`app_id` 必須等於自己的 app_id、檢查 `exp`。需要即時確認停權或登出時，改呼叫 `GET /v1/me`。
