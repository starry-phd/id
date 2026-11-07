# Starry 平台（Starry ID）

Starry ID 會員與登入、App Registry、購買權益投影與每日對帳、Starry Battery（免費 AI 用量月額度）、推播 Token、系統 Email、客服、Web 帳號中心與 Admin Lite，部署在 Cloudflare Workers。正式網址：https://id.starry.phd。規格與開發規則見 [AGENTS.md](AGENTS.md)，業主設定步驟見 [docs/owner-setup.md](docs/owner-setup.md)，App 串接方式見 [docs/integration-guide.md](docs/integration-guide.md)。

## API（`/v1`，App 使用 Bearer Access Token）

完整契約：[`openapi/starry-id.v1.json`](openapi/starry-id.v1.json)（OpenAPI 3.1，由程式碼產生；`npm run openapi` 更新）。

| 路由 | 說明 | 規格 |
|---|---|---|
| `GET /v1/health` | 服務狀態與 D1 連線檢查 | S-PLT-07 |
| `GET /v1/apps/{app_id}/config` | 狀態（含 Admin 覆寫）、最低版本、白名單設定 | S-PLT-01/02 |
| `POST /v1/auth/nonce` | 單次有效的登入 nonce（10 分鐘，綁 app_id） | S-ID-01 |
| `POST /v1/auth/apple`、`/v1/auth/google` | 原生 ID Token 登入／註冊；Apple 可附 `authorization_code` | S-ID-01/03 |
| `POST /v1/auth/refresh` | 換發 Token；舊 Refresh Token 重用即撤銷 Session | S-ID-04 |
| `POST /v1/auth/logout`、`/v1/auth/logout-all` | 登出本裝置／所有裝置（立即生效） | S-ID-05 |
| `GET /v1/me` | 會員、個人資料（姓名、頭像、聯絡 Email、手機、地區、生日與推算資訊、座右銘、公開設定、各欄最後修改時間）、其他會員看到的公開預覽、登入方式、同意與刪除狀態 | S-ID-08/09 |
| `PATCH /v1/me/profile` | 修改任一欄位與公開設定；需 `If-Match`，版本不符回 409 | S-ID-08 |
| `POST /v1/me/contact-email/verification` | 重寄聯絡 Email 確認信 | S-ID-08 |
| `GET /v1/me/motto-suggestion` | 隨機座右銘提案（不會儲存） | S-ID-08 |
| `PUT`／`DELETE /v1/me/avatar` | 上傳（WebP／JPEG／PNG ≤ 256 KB）或移除頭像 | S-ID-08 |
| `POST /v1/me/consents` | 同意目前版本的條款與隱私權政策 | S-ID-09 |
| `POST`／`DELETE /v1/me/deletion` | 立即永久刪除帳號（無等待期）／`DELETE` 僅為舊 App 相容（永遠回 409，沒有可撤回的刪除） | S-ID-06 |
| `POST /v1/me/identities/{apple\|google}` | 加綁另一種登入方式；該登入方式之前另外建立過帳號時，可帶 `merge_other_account` 合併（有購買、管理人員、停權者除外） | S-ID-02 |
| `GET /v1/me/entitlements` | 本 App 的有效權益（RevenueCat 投影） | S-BIL-04 |
| `GET /v1/me/battery` | 本月 Battery 額度、已用、預留、剩餘、下次恢復時間與近 30 天紀錄 | S-BAT-04 |
| `POST /v1/battery/reservations` | App 後端預留 Battery（服務金鑰＋同一 App 的會員 Token；冪等鍵） | S-BAT-03/06 |
| `POST /v1/battery/reservations/{id}/commit`、`/release` | App 後端確認扣除（可帶實際用量）／釋放；冪等，逾時後不扣除 | S-BAT-03 |
| `PUT`／`DELETE /v1/me/push-tokens` | 登記／移除 Expo 推播 Token | A-04 |
| `GET`／`PUT /v1/me/notification-preferences` | 各推播分類開關 | S-NTF-01 |
| `GET /v1/avatars/{user}/{file}?exp&sig` | 以短效簽章讀取頭像 | S-ID-08 |
| `POST /v1/billing/revenuecat/{app_id}` | RevenueCat Webhook（每款 App 各自的授權值） | S-BIL-04 |
| `GET /.well-known/jwks.json` | Access Token 公鑰，供 App 後端驗證 | S-ID-04 |

## 網頁（Cookie Session）

| 路徑 | 說明 | 規格 |
|---|---|---|
| `/account` | 登入（Google／Apple 網頁登入）、個人資料、同意條款、刪除、登入中的裝置（登出單一裝置／所有裝置）、Starry Battery 額度與紀錄 | S-WEB-01、S-ID-05、S-BAT-04 |
| `/account/profile` | 個人資料：每欄 ✏️ 編輯、自動儲存、👁 公開設定、最後修改時間、生日推算資訊與彩色九宮格、隨機座右銘；`/account/verify-email` 確認聯絡信箱 | S-ID-08 |
| `/account/link` | 加綁另一種登入方式（需 10 分鐘內登入過）；Google、Apple 分開登入過時，確認後合併成同一個帳號 | S-ID-02 |
| `/privacy`、`/terms` | 隱私權政策（版本 2026-11-03.2）、服務條款（版本 2026-11-03） | S-WEB-01 |
| `/support` | 客服與檢舉表單（訪客與會員；附件選填：PNG／JPEG／WebP／PDF ≤ 2 MB，以檔案內容判斷類型；設定 Turnstile 後啟用驗證） | S-WEB-02 |
| `/admin` | Admin Lite：會員查詢（完整姓名與 Email、會員編號、Battery 額度、多條件篩選，開啟會員資料會留稽核紀錄）、強制登出、停權／復權、角色、Battery 人工調整（Admin）與每月額度／任務消耗設定（Owner）、客服單（含附件下載、Email 回覆）、App 登記與狀態（Owner 可在後台新增 App，並產生給開發 AI 的串接指令）、稽核、API 文件 | S-ADM-01、S-BAT-02/05 |
| `/auth/{apple\|google}/start`、`/callback` | 登入中繼：App 的 Android 版與網頁版經由 id.starry.phd 登入 Apple／Google，再回到已登記的 deep link 或網頁（Apple、Google 只需設定一次） | S-ID-01 |
| `/account/claim-owner` | 一次性設定 Owner（設定 `OWNER_CLAIM_CODE` 時才出現） | S-ID-10 |

## 背景作業

- 每分鐘 Cron：釋放逾時的 Battery 預留（S-BAT-03）。
- 每日 03:17（台灣）Cron：清除刪帳期滿會員（含 Battery 與權益資料）、撤銷 Apple Token、刪除已移除客服單的附件、刪除 RevenueCat 客戶、處理未完成的 Webhook 事件、與 RevenueCat 對帳（每次最多 200 組會員／App，最久未比對的優先）、清理過期 nonce／Session／客服單、稽核保留期（一般 90 天、安全 1 年）、Battery 帳本保留 1 年。
- 錯誤監控：設定 `SENTRY_DSN`（變數）後，伺服器錯誤與排程失敗會送到 Sentry（不含會員資料）。
- GitHub Actions：每 15 分鐘外部探測（故障開一張 Issue、恢復自動關閉）、每週匯出三個 D1 到 R2 `starry-backups`、手動維運工作（`Ops`：刪除 `OWNER_CLAIM_CODE`、建立 Turnstile）、手動壓力測試（`Load test`，見 `docs/load-test.md`）、staging 還原演練（`Restore drill (staging)`，見 `docs/restore.md`）。

## Secrets

| 名稱 | 放在 | 由誰設定 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | GitHub Actions Secret | 業主 |
| `ACCESS_TOKEN_PRIVATE_JWK`、`DATA_ENCRYPTION_KEY` | Workers Secret | 部署流程自動產生（只在缺少時建立） |
| `OWNER_CLAIM_CODE`（暫時） | Workers Secret | 業主；Owner 認領後由 `Ops` 工作流程刪除 |
| `APPLE_TEAM_ID`、`APPLE_KEY_ID`、`APPLE_PRIVATE_KEY` | Workers Secret | 業主（Sign in with Apple 金鑰） |
| `REVENUECAT_WEBHOOK_AUTH`、`REVENUECAT_API_KEYS` | Workers Secret（JSON，每款 App 一筆） | 業主（RevenueCat 專案建立後） |
| `BATTERY_SERVICE_KEYS` | Workers Secret（JSON，每款 App 一筆，32 字以上） | Claude（App 後端開始使用 Battery 時，同一值設定在該 App 後端） |
| `TURNSTILE_SECRET_KEY`；`TURNSTILE_SITE_KEY`（變數，寫在 wrangler.jsonc） | Workers | 已由 `Ops` 工作流程（setup-turnstile）建立 |
| `send_email` 綁定 `EMAIL`；`EMAIL_FROM`、`SUPPORT_EMAIL`（變數） | wrangler.jsonc | Claude（已於 2026-11-03 加入；Email Sending 網域 starry.phd 已啟用） |

各 App 的 Apple／Google client ID 存在該 App 的登記資料（Admin Lite → 編輯登記資料）的登入對象欄位（不是秘密）；清單為空時該登入方式回 503。

## 結構

```
src/auth/       Token 驗證、Session、登入路由
src/identity/   會員、刪帳、角色、加綁、Apple、頭像、網頁 Session、每日作業
src/billing/    RevenueCat Webhook、權益投影與每日對帳
src/battery/    Starry Battery：月配額、預留／確認／釋放、帳本
src/notify/     推播 Token、Expo Push、系統 Email
src/support/    客服單、附件、Email 回覆
src/web/        帳號中心、客服表單、Admin Lite、條款（伺服器端產生 HTML）
config/apps.json 登入中樞 account 的固定設定（其他 App 都登記在資料庫，由 Admin Lite 管理）
migrations/     D1 migration：identity、billing、battery
test/           整合測試（打包後在本機 workerd＋D1 執行）
test/unit/      領域邏輯單元測試（SQLite 版 D1 替身，tsx 執行）
docs/           ADR、業主設定、App 串接說明
```

## 環境

| 環境 | Worker | D1 | R2 |
|---|---|---|---|
| staging | `starry-id-staging`（workers.dev） | `starry-identity-staging`、`starry-billing-staging`、`starry-battery-staging` | `starry-avatars-staging`、`starry-support-files-staging` |
| production | `starry-id`（https://id.starry.phd） | `starry-identity`、`starry-billing`、`starry-battery` | `starry-avatars`、`starry-support-files`、`starry-backups` |

## 指令

```bash
npm install
npm run check      # typecheck + lint + 打包 + workerd 整合測試 + 單元測試
npm run test:unit  # 只跑單元測試
```
