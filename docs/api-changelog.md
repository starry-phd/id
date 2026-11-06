# Starry ID API 變更紀錄

對外契約：[`openapi/starry-id.v1.json`](../openapi/starry-id.v1.json)（OpenAPI 3.1，由程式碼產生）。

- **相容性規則**：`/v1` 只做向下相容的變更（新增端點、新增選填欄位、回應新增欄位）。CI 以 oasdiff 擋下破壞性變更；需要破壞性變更時改走 `/v2`，與 `/v1` 並存到所有 App 更新完成，並寫在本檔最上方。
- **App 端請容忍回應中多出的欄位**（不要用嚴格模式解析回應）。
- 日期為台灣時間；每筆對應一個已合併並部署的 PR。

## 2026-11-07

向下相容的新增：`POST /v1/directory/members`（App 後端用服務金鑰查自家會員的會員編號、暱稱、頭像與公開姓名）列入 OpenAPI 檔；行為與回應沒有變更。

業主明確同意的破壞性調整（目前生態系 App 都只是測試用途，沒有正式用戶）：Battery 的 `units` 上限由 100000 降為 100（`POST /v1/battery/reservations`、`…/commit`）。已登記在 `openapi/breaking-changes-ack.txt`，CI 的 oasdiff 檢查會略過這兩筆；之後新增的破壞性變更仍會被擋下。

## 2026-11-03

全部為向下相容的新增。

| PR | 變更 |
|---|---|
| #33 | 登入中繼擴充為 Google 與 Apple，並可回到 App 網頁版（`web_origins` 內的 https 網址，結果放在 `#` 之後）：`/auth/{google\|apple}/start`、`/auth/{google\|apple}/callback`（網頁，不屬於 `/v1`；`/v1` 沒有變更） |
| #31 | `Profile` 新增 `contact_email`、`contact_email_verified`、`phone`、`country`、`region`、`city`、`motto`、`derived`（星座、天賦數、生命靈數、九宮格）、`visibility`、`field_updated_at`；`GET /v1/me` 新增 `public_profile`；`PATCH /v1/me/profile` 可改上述欄位與 `visibility`；新增 `POST /v1/me/contact-email/verification`、`GET /v1/me/motto-suggestion` |
| #30 | 登入與加綁的請求新增選填 `redirect_uri`（Apple 網頁流程的 code exchange）；`/v1` 對已登記的 App 網頁版網址開放 CORS；新增 Android 的 Apple 登入中繼頁 `/auth/apple/start`、`/auth/apple/callback`（網頁，不屬於 `/v1`） |
| #29 | `POST /v1/me/identities/{provider}`：請求新增選填 `merge_other_account`，回應新增 `merged`；409 回應新增 `mergeable`、`merge_blocked`、`other_account_created_at` |
| #27 | 新增 `GET /v1/me/battery`、`POST /v1/battery/reservations`、`…/{id}/commit`、`…/{id}/release`；安全機制新增 `appKey`（`x-starry-app-key`） |
| #13 | `/v1` 首版契約由程式碼產生（S-PLT-03） |
