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
6. 帳號刪除是立即永久刪除，沒有撤回期；`user.status` 只會是 `active`（停權時 API 回 403 `ACCOUNT_SUSPENDED`）。舊欄位 `deletion_purge_at`、`deletion_requested_at` 永遠是 `null`，不需處理。

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
| 加綁登入方式 | 重新取 nonce 並以另一個供應商登入取得 ID Token，`POST /v1/me/identities/{provider}`。若回 409 `IDENTITY_IN_USE` 且 `mergeable: true`，代表會員之前用這個登入方式另外建立過 Starry 帳號：向會員說明「另一個帳號會被刪除、只保留目前帳號」，同意後帶 `"merge_other_account": true` 重送即合併（回 201 `merged: true`）。`merge_blocked` 有值時（有購買紀錄、管理人員、已停權、另有登入方式）請引導聯絡客服 |
| 登出 | 先 `DELETE /v1/me/push-tokens`，再 `POST /v1/auth/logout`，最後 RevenueCat `logOut()` |
| 登出所有裝置 | `POST /v1/auth/logout-all` |
| 刪除帳號（Apple 與 Google 皆要求 App 內入口） | 說明「立即永久刪除、無法復原」與「不會自動取消訂閱」，請使用者輸入 DELETE 之類的明確確認後 `POST /v1/me/deletion` `{"confirm": true}`，成功後清除本機 Token（沒有撤回期；回應的 `status` 為 `deleted`） |

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

## 8. Echo 現有程式的對應（給 starry-phd/echo）

Echo 的 `src/auth/centralMemberContract.ts` 依已被 v2.0 取代的 v1.0 規格，預期 `GET /v1/starry-id/members/me` 回傳五個欄位。v2.0 平台不提供該路徑，請改用 `GET /v1/me`，對應如下：

| Echo 舊 DTO | `GET /v1/me` |
|---|---|
| `s_user_id` | `user_id` |
| `display_name` | `profile.display_name`（可能為 null，顯示時退回「繁星會員」） |
| `profile_revision` | `profile.version`（修改時放在 `If-Match`） |
| `directory_opt_in`、`display_name_public` | v2.0 沒有會員名錄（屬 H-Global 階段 H-03），一律視為 false |

Echo 的 D1 只存 `user_id` 當外鍵，不複製會員主檔；Echo Worker 需要辨識會員時，以 JWKS 驗證 Access Token（第 7 節），並檢查 `app_id === "echo"`。

## 9. Starry Battery（只限 App 後端）

Battery 是 Starry 會員共用的免費 AI 用量月額度（規格 S-BAT），每月 1 日（台灣時間）恢復，不累積、不能購買或轉讓。**App 本身不能扣 Battery**，只有 App 自己的後端能用服務金鑰操作；服務金鑰不可放進 App。

前置：在後台新增 App 時勾選「同時開通 Starry Battery」（預設勾選），會自動建立 App 後端的服務金鑰；金鑰只顯示一次，請存成 App 後端的 Secret（名稱 `STARRY_BATTERY_KEY`），遺失可在 App 的串接指令頁重新產生。**金鑰只給業主自己用，不要貼給 AI。** 既有 App 仍可使用 Worker Secret `BATTERY_SERVICE_KEYS`（`{"echo":"…"}`，32 字以上隨機字串，同一個值設定在 App 後端），兩種金鑰並行有效。

**扣量由 App 自己決定（2026-11-07 改版）：** 中央只管「每月額度、逾時時間、單次預留上限（全站 100 顆）」，不再登記任務類型與單位消耗。每個任務要扣幾顆，由 App 在自己的設定頁設定（只有超級管理員可改）；App 後端必須在伺服器端再次確認呼叫者是 Owner（`GET /v1/me` 的 `staff_role === "owner"`），不能只靠前端隱藏。任務代碼自行命名，只要以 `<app_id>.` 開頭（如 `echo.transcribe`）。舊的任務類型表與舊紀錄已捨棄；舊 App 請改成直接送顆數。

1. 會員在 App 發起 AI 任務 → App 呼叫自己的後端（帶 Starry Access Token）。
2. App 後端預留：`POST /v1/battery/reservations`，標頭 `Authorization: Bearer <會員 Access Token>` 與 `x-starry-app-key: <服務金鑰>`，內容 `{"task_type": "echo.transcribe", "task_label": "語音轉文字", "units": 3, "idempotency_key": "<每個任務唯一>"}`。`units` 就是要預留的顆數（1–100），`task_label`（選填、最多 40 字）會顯示在會員的 Battery 紀錄。
   - 201：預留成功，取得 `reservation_id` 與 `expires_at`（預設 3 分鐘）。網路重試用同一個 `idempotency_key` 會拿到同一筆（200）。
   - 409 `BATTERY_INSUFFICIENT`：本月額度不足，回應附 `balance`，請 App 顯示剩餘額度與下次恢復日。
   - 409 `BATTERY_APP_CAP`：這款 App 本月的用量已達 Starry 設定的上限，請提示稍後再試，不要開始 AI 任務。
   - 503 `SERVICE_UNAVAILABLE`：Starry 在維護模式，新的 Battery 任務暫停（進行中的任務仍可 commit／release）；請提示稍後再試，不要開始 AI 任務。
3. 執行 AI 任務。
4. 成功：`POST /v1/battery/reservations/{id}/commit`（可帶 `{"units": 實際扣除顆數}`，不超過預留）；失敗或取消：`POST /v1/battery/reservations/{id}/release`。兩者只需服務金鑰，重送不會重複扣除。
5. 逾時未確認的預留每分鐘自動歸還；逾時後才回來的結果 commit 會得到 409 `RESERVATION_EXPIRED`，不扣額度。
6. Starry ID 無法連線時一律不開始 AI 任務（fail closed，S-PLT-09）。

會員查詢：`GET /v1/me/battery`（本月額度、已用、預留中、剩餘、下次恢復時間與近 30 天紀錄）；網頁帳號中心也會顯示。

**量子電池（App 內購加量包）**：Battery 本身全部免費。業主可在後台指定的 App 開放內購「量子電池」加量包（App 的串接指令頁 → 量子電池設定，填商店商品代碼與顆數）。量子電池只能在購買的那款 App 使用、不會過期。App 端照原本流程預留／扣款即可：系統先扣免費的每月 Battery，不足的部分才扣該 App 的量子電池，預留回應的 `quantum_amount`／`quantum_charged` 會顯示用了多少。購買由 RevenueCat 通知自動入帳（一次性商品 NON_RENEWING_PURCHASE，同一筆交易只入帳一次），客服退款會自動扣回尚未使用的部分。商店規定：虛擬貨幣只能在購買它的 App 內使用，所以量子電池不跨 App。

## 9.5 App 能讀到哪些會員資料（2026-11-07）

- **本人（用會員通行證）：** `GET /v1/me` 回傳 `staff_role`（`owner`／`admin`／`support`，一般會員為 null）、姓名、頭像、Email（`identities[].email`、`profile.contact_email`）與 `member_no`（會員編號，例如 `886-0112342`，永久不變，也是 R2 資料夾名稱與客服編號）。App 沒有寫入權，其餘詳細資料請導向 `https://id.starry.phd/account` 讓會員自己編輯。
- **排行榜等需要顯示其他會員時（只能在 App 後端，用服務金鑰 `x-starry-app-key`）：** `POST /v1/directory/members`，body `{"user_ids": ["<會員ID>", …]}`（1～50 個）。回 `{"members":[{"user_id","member_no","nickname","display_name","avatar_url"}]}`。排行榜請優先顯示 `nickname`（暱稱）與頭像：這兩項是會員強制公開、無法隱藏的；`display_name`（姓名）會員可以選擇不公開（為 `null`）。只回「曾登入這款 App」的會員；姓名遵守會員的公開設定（不公開為 `null`），暱稱與頭像一律公開；**不含 Email 或任何其他欄位**。`avatar_url` 是一小時有效的簽章路徑。這個端點已列入 OpenAPI 檔（`/v1/directory/members`）。
- App 自己的使用紀錄與排名由 App 自己計算與保存，以 `user_id`（或 `member_no`）當 key。

## 10. 新 App 接入 Starry ID（每款 App 一次）

**用後台登記（建議，不改程式碼）**

1. Owner 登入 `https://id.starry.phd/admin/apps`，按「新增 App」，填 `app_id`（小寫英文、數字、連字號）、名稱、iOS Bundle ID、Android package，有網頁版再填網頁版來源。
2. iOS、Android、網頁三個平台預設都走 Starry 登入中繼（瀏覽器登入）：帳號中心的 Apple Services ID 與 Google 網頁用戶端會自動加進這款 App，不必到 Apple、Google 後台為它做任何設定。
3. 建立後頁面會產生一段「給開發 AI 的串接指令」（之後也能從 App 清單的「給開發 AI 的串接指令」再取得），整段貼給負責開發這款 App 的 AI。內容只有公開資料，沒有秘密。
4. 後台登記 30 秒內生效，可用 `GET /v1/apps/<app_id>/config` 確認。paused／killed 狀態、Battery 金鑰、稽核紀錄都和既有 App 相同。
5. 後台只能編輯後台登記的 App；`config/apps.json` 的 App 與 `account` 不能被後台覆蓋。
6. 只有日後改用原生登入時，業主才需要到後台設定：iOS 原生 Apple 登入要把該 App ID 的 Sign in with Apple 設為群組，主 App ID 選 `phd.starry.app`（G-02）；Android 原生 Google 登入要建 Android 用戶端；iOS 原生 Google 登入的 iOS 用戶端 ID 要填在「額外的 Google 用戶端 ID」。
7. RevenueCat（要販售時）：為這款 App 建立獨立專案（S-BIL-01），Webhook URL `https://id.starry.phd/v1/billing/revenuecat/<app_id>`，再依 `docs/owner-setup.md` 第 6 步設定 Secrets。
8. Battery（要用 AI 時）：見第 9 節。

**用設定檔登記（既有 App，需要 PR）**

把以下內容加入 `config/apps.json`（都不是秘密）。設定檔有格式檢查，填錯 CI 會失敗、不會部署。欄位與後台表單相同。

```json
{
  "app_id": "echo",
  "name": "繁星回聲 Echo",
  "ios_bundle_id": "phd.starry.echo",
  "android_package": "phd.starry.echo",
  "status": "active",
  "scopes": ["profile:read", "profile:write"],
  "min_version": "1.0.0",
  "config": {},
  "auth": {
    "apple_audiences": ["phd.starry.echo", "phd.starry.id.web"],
    "google_audiences": ["<iOS Client ID>", "<Web Client ID>"]
  }
}
```

`apple_audiences`：iOS Bundle ID（原生登入）與 Services ID（Android 網頁流程）；`google_audiences`：iOS Client ID 與 Android 用的 Web Client ID。

## 11. 繁星回聲對接回覆（2026-11-03）

回覆繁星回聲開發 AI 的「繁星回聲 App ↔ Starry ID 串接對接單」，編號對應對接單第二節。第三節「App 端實作」核對無誤。

### 11.1 App 登記（`config/apps.json` 的 `echo`，已部署）

| 欄位 | 值 |
|---|---|
| `ios_bundle_id`、`android_package` | `phd.starry.echo` |
| `apple_audiences` | `phd.starry.echo`（iOS 原生）、`phd.starry.id.web`（Android 與網頁版的 Apple 網頁流程） |
| `google_audiences` | `529568041037-j9gd4baq8k239qv7an2f53rh3srbgtnm.apps.googleusercontent.com`（Web Client「Starry ID Web」）。業主建立 iOS Client 後會再加入 iOS Client ID |
| `web_origins` | `https://echo.starry.phd`（CORS 與 Apple redirect_uri 白名單） |
| `return_urls` | `echostarry://auth/apple`（Android Apple 登入中繼的回傳網址） |
| `min_version` | `0.0.0`；上架後要強制更新時，告訴 Claude 要改成哪一版 |

Google Client 由業主建立（步驟見 `docs/owner-setup.md` 第 11 步），App 端設定：

- **iOS**：iOS Client ID（`iosClientId`）與其反轉網址當 URL scheme。
- **Android**：不需要在程式中放 Android Client ID；`webClientId`（Credential Manager 的 `serverClientId`）用上面的 Web Client ID，ID Token 的 aud 會是它。Google 依套件名稱＋簽章 SHA-1 辨識 App，所以 EAS 的上傳金鑰與 Google Play 應用程式簽署金鑰的 SHA-1 都要登記（請把 SHA-1 交給業主）。
- **網頁版**：不需要 Google 用戶端設定，走 Starry 登入中繼（11.2）。

### 11.2 網頁版登入（2026-11-03 更新：改用 Starry 登入中繼）

- (a) 網頁版**不必**自己載入 Google Identity Services／Sign in with Apple JS，也不必向 Apple、Google 登記自己的網域。改用 Starry 的登入中繼（與 Android 的 Apple 登入同一套，見 11.3）：
  1. `POST /v1/auth/nonce` `{"app_id":"echo"}`，把原值 nonce 存在 `sessionStorage`（整頁跳轉後還要用）。
  2. 整頁導向 `https://id.starry.phd/auth/{google|apple}/start?app_id=echo&nonce=<SHA-256(nonce) 十六進位小寫>&return=<回傳網址>&state=<隨機字串>`。回傳網址必須在 `web_origins` 之內，例如 `https://echo.starry.phd/auth/done`（路徑由 App 自訂）。
  3. 登入完成後回到 `<回傳網址>#id_token=…&state=…`（Apple 另有 `code`；失敗為 `#error=…&state=…`）。結果放在 `#` 之後，不會送到任何伺服器。讀取後請立刻用 `history.replaceState` 清掉網址中的 `#`。
  4. 核對 `state`，呼叫 `POST /v1/auth/{google|apple}`：`{"app_id":"echo","id_token":…,"nonce":<原值>}`；Apple 另附 `"authorization_code":<code>,"redirect_uri":"https://id.starry.phd/auth/apple/callback"`。
  - 網頁版換網域（例如上線到 `echo.starry.phd`）或新增其他 App 網頁版時，只需由 Claude 修改 `config/apps.json` 的 `web_origins`，業主不必再到 Apple、Google 後台設定。
- (b) 已開放 CORS（production 與 staging）：Origin `https://echo.starry.phd`；允許標頭 `authorization`、`content-type`、`if-match`；方法 GET／POST／PUT／PATCH／DELETE／OPTIONS（預檢回 204）；公開標頭 `etag`、`x-request-id`、`retry-after`；不使用 Cookie（不要設 `credentials: 'include'`）。頭像 `avatar_url` 是相對路徑，加上 API 網址即可用 `<img>` 跨網域顯示。
- (c) 建議 Access Token 只放記憶體；Refresh Token 放 `sessionStorage`（關閉分頁即清除，重新整理不必重登），不要放 `localStorage`。Starry 的 Refresh Token 每次使用都會換新，舊的被重用會撤銷整個 Session，可降低外洩風險。網頁版請設定嚴格 CSP，不載入不必要的第三方腳本。

### 11.3 Android 的 Apple 登入（網頁流程，已部署）

1. `POST /v1/auth/nonce` `{"app_id":"echo"}`，原值 nonce 只留在 App 記憶體。
2. `nonceHash` = nonce 的 SHA-256 十六進位小寫字串（`expo-crypto` 的 `digestStringAsync(SHA256, nonce)`）。
3. `expo-web-browser` 的 `openAuthSessionAsync(url, 'echostarry://auth/apple')`，其中 url 為：
   `https://id.starry.phd/auth/apple/start?app_id=echo&nonce=<nonceHash>&return=echostarry%3A%2F%2Fauth%2Fapple&state=<隨機字串>`
4. Starry 把瀏覽器導到 Apple；Apple 以 form_post 回到 `https://id.starry.phd/auth/apple/callback`；Starry 再導回 `echostarry://auth/apple?id_token=…&code=…&state=…`（取消或失敗為 `?error=…&state=…`）。
5. App 核對 `state` 後呼叫 `POST /v1/auth/apple`：`{"app_id":"echo","id_token":…,"nonce":<原值>,"authorization_code":<code>,"redirect_uri":"https://id.starry.phd/auth/apple/callback"}`。
6. 交給 Apple 的只有雜湊；攔截到回傳網址的人沒有原值 nonce，無法登入。
7. App 的 `app.json` 要宣告 scheme `echostarry`。iOS 用原生 `expo-apple-authentication`（aud 為 `phd.starry.echo`），Android 的 Google 登入用原生套件，兩者都不經過中繼。
8. staging 的中繼網址為 `https://starry-id-staging.starry-phd.workers.dev/auth/{apple|google}/start`。

### 11.4 環境

| 環境 | API 網址 | Access Token `iss` | 狀態 |
|---|---|---|---|
| production | `https://id.starry.phd` | `starry-id:production` | 已部署，`/v1/health` 為 ok |
| staging | `https://starry-id-staging.starry-phd.workers.dev` | `starry-id:staging` | 已部署，`/v1/health` 為 ok |

每次合併到 main 都會自動部署 staging → production，並以 `/v1/health` 做 smoke test，失敗自動回滾。staging 與 production 的資料庫和簽章金鑰各自獨立，帳號不互通；App 設定共用同一份 `config/apps.json`。

### 11.5 契約穩定

同意。`openapi/starry-id.v1.json` 視為對外契約，CI 以 oasdiff 擋下破壞性變更；破壞性改版走 `/v2`。所有變更記在 [`docs/api-changelog.md`](api-changelog.md)。請 App 容忍回應中多出的欄位。

### 11.6 測試範例

[`docs/fixtures/`](fixtures/README.md) 提供主要端點的成功與錯誤回應範例與錯誤碼對照表。CI 會實際呼叫 API 比對範例的欄位與型別，範例過時就無法合併。

### 11.7 對接單以外，App 需要知道的變更

- **會員資料欄位**（ADR 0006）：`profile` 新增聯絡 Email、手機、國家／省州／城市、座右銘、生日推算資訊（星座、天賦數、生命靈數、九宮格）、公開設定、各欄最後修改時間。`PATCH /v1/me/profile` 只送要改的欄位；顯示名稱為 null 時顯示「繁星會員」的做法不變。
- **帳號合併**：加綁時若回 409 `IDENTITY_IN_USE` 且 `mergeable: true`，請詢問會員後帶 `merge_other_account: true` 重送（第 4 節）。
- **隱私權政策** 版本請以 App 登入後的 `consent_required` 為準（目前 `2026-11-07.2`，條款 `2026-11-07`）；會員登入後 `consent_required` 為 true 時請顯示同意流程。
- **交接 Issue**：舊 Repo 的 #220 已隨舊 Repo 刪除，starry-phd/id 的交接 Issue 是 [#2](https://github.com/starry-phd/id/issues/2)。

## 12. 已串接的 App：更新檢查清單（2026-11-07）

已經串接過的 App 不必重做。請對照下列項目，只補上缺少或過時的部分，開 PR 後回報：

1. **Battery 錯誤處理**：預留可能回 409 `BATTERY_APP_CAP`（這款 App 本月用量達上限）或 503 `SERVICE_UNAVAILABLE`（維護模式）；兩者都不得開始 AI 任務，並提示會員稍後再試（第 9 節）。
2. **量子電池**：`GET /v1/me/battery` 多了 `quantum`；預留回應多了 `quantum_amount`、`quantum_charged`。先扣免費月額度，不足才扣這款 App 的量子電池，不過期、不跨 App。若這款 App 要販售，商品代碼與顆數由業主在後台設定，購買走 RevenueCat 一次性商品（`NON_RENEWING_PURCHASE`）（第 9 節）。
3. **單檔 SDK**：App 後端可改用 `sdk/starry-sdk.ts` 取代自己寫的呼叫（附錄）。
4. **啟動讀取遠端設定**：`GET /v1/apps/{app_id}/config` 回傳 `status`、`min_version` 與業主在後台設定的鍵值（內容公開，不放機密），可用來做開關與強制更新（第 1 節）。
5. **驗證 Token 的金鑰**：App 後端要快取 `GET /.well-known/jwks.json`，遇到不認得的 `kid` 時重新抓取；金鑰輪替期間新舊兩把會同時有效。
6. **刪除帳號**：立即永久刪除、沒有撤回期、不會自動取消商店訂閱（第 4 節）。App 內的說明文字要一致。
7. **隱私權政策與條款**：版本更新後，登入回應的 `consent_required` 為 true 時要顯示同意流程。
8. **Passkey（2026-11-07 起，每款 App 都要有）**：登入頁（iOS、Android、網頁）提供「使用 Passkey 登入」，設定頁能新增、列出、移除 Passkey，做法見第 13 節。
9. **不需要 App 處理的新功能**：邀請碼（會員在 `https://id.starry.phd/account` 輸入兌換，獲得這款 App 的免費量子電池）、公告與維護模式（由後台設定，App 照 `status` 顯示即可）、資料匯出。

## 13. Passkey（每款 App 的登入頁與設定頁）

Passkey 屬於 Starry ID：relying party ID 是 Starry ID 網址的主機名稱（正式環境 `id.starry.phd`），所以會員在帳號中心或任何一款 App 建立的 Passkey，在所有 App 都能用（跨裝置同步由系統的 Google 密碼管理工具或 iCloud 鑰匙圈負責）。Passkey 只是額外的登入方式，不能取代 Apple／Google，也不會建立新會員。

**登入（不需要先登入）**
1. `POST /v1/auth/passkey/options`，body `{"app_id"}` → `publicKey`（`challenge`、`rpId`、`userVerification: required`、`allowCredentials: []`）。challenge 單次有效、10 分鐘、綁定這款 App。
2. 交給系統的 Passkey 功能簽署（iOS：`ASAuthorizationPlatformPublicKeyCredentialProvider`；Android：Credential Manager；網頁：`navigator.credentials.get`；Expo 可用 `react-native-passkey`，需要 development build）。`rpId` 一律用回傳值，不是 App 自己的網域。
3. `POST /v1/auth/passkey`，body `{app_id, id, clientDataJSON, authenticatorData, signature, device_label?}`（全部 base64url）→ 與 Apple／Google 登入相同的回應（`access_token`、`refresh_token`、`user`、`consent_required`）。停權回 403 `ACCOUNT_SUSPENDED`；簽章、挑戰或來源不對回 401。

**新增、列出、移除（需要登入）**
- `POST /v1/me/passkeys/options` → 建立選項。需要 10 分鐘內登入過，否則 403 `REAUTH_REQUIRED`，請會員重新登入再試。
- `POST /v1/me/passkeys`，body `{clientDataJSON, attestationObject, name?}` → 201。每位會員最多 10 把（409）。
- `GET /v1/me/passkeys`、`DELETE /v1/me/passkeys/{id}`。

**平台設定（業主在 Admin Lite「編輯登記資料」填，Starry ID 自動產生驗證檔）**
- iOS：填 Apple Team ID；App 的 `app.json` 加 `ios.associatedDomains: ["webcredentials:id.starry.phd"]`。驗證檔：`/.well-known/apple-app-site-association`。
- Android：填簽章憑證 SHA-256 指紋（上架後從 Play Console「應用程式簽署」複製；本機測試用 debug 憑證指紋）。驗證檔：`/.well-known/assetlinks.json`。
- 網頁：App 的網頁來源已列在 `/.well-known/webauthn`（WebAuthn 相關來源），Chrome 128、Safari 18 以上可直接使用；先判斷 `window.PublicKeyCredential`，不支援時只顯示 Apple／Google 登入。
- 沒填 Team ID／指紋之前，iOS／Android 的 Passkey 會失敗（網頁版不受影響）；請把這件事列入回報給業主的清單。

**錯誤處理**：使用者取消不要顯示錯誤；`InvalidStateError` 表示這支裝置已經有這把 Passkey；找不到 Passkey 時引導改用 Apple 或 Google 登入。

## 附錄：Starry SDK（App 後端用）

單一檔案、無相依套件：[`sdk/starry-sdk.ts`](../sdk/starry-sdk.ts)，複製到 App 後端即可。包含 `me`、`battery`、`reserve`／`commit`／`release`、`withBattery`（預留→執行→成功扣款、失敗自動歸還）與 `directory`。服務金鑰只放在 App 後端的 Secret。
