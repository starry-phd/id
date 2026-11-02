# Starry 平台 API

Starry ID 與 Starry 平台服務，部署在 Cloudflare Workers。規格與開發規則見 [AGENTS.md](AGENTS.md)。

| 路由 | 說明 |
|---|---|
| `GET /v1/health` | 服務狀態與 D1 連線檢查 |
| `GET /v1/apps/{app_id}/config` | App 啟動時讀取的狀態、最低版本與白名單設定 |
| `POST /v1/auth/nonce` | 取得單次有效的登入 nonce（10 分鐘） |
| `POST /v1/auth/apple`、`POST /v1/auth/google` | 以 App 原生取得的 ID Token 登入或註冊 |
| `POST /v1/auth/refresh` | 換發 Token；舊 Refresh Token 重用會撤銷該 Session |
| `POST /v1/auth/logout`、`POST /v1/auth/logout-all` | 登出本裝置／所有裝置 |
| `GET /v1/me` | 會員、個人資料、已綁定登入方式與同意狀態 |
| `PATCH /v1/me/profile` | 修改暱稱、生日、語系；需帶 `If-Match` 版本號 |
| `POST /v1/me/consents` | 同意目前版本的服務條款與隱私權政策 |
| `GET /.well-known/jwks.json` | Access Token 公鑰，供 Echo 等 App 後端驗證 |

## 必要 Secrets

| 名稱 | 放在 | 用途 |
|---|---|---|
| `ACCESS_TOKEN_PRIVATE_JWK` | Workers Secret（staging、production 各一把） | ES256 私鑰，簽發 Access Token；未設定時登入 API 回 503 |
| `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | GitHub Actions Secret | 自動部署 |

各 App 的 Apple／Google client ID 寫在 `config/apps.json` 的 `auth`；清單為空時該登入方式回 503。

## 結構

```
src/            Worker 程式（Hono）
config/apps.json App Registry，每款 App 一筆
migrations/     D1 migration，依資料庫分資料夾
test/           本機 workerd + D1 測試（Miniflare）
docs/adr/       架構決策紀錄
```

## 環境

| 環境 | Worker | D1 |
|---|---|---|
| staging | `starry-id-staging`（workers.dev） | `starry-identity-staging` |
| production | `starry-id`（https://id.starry.phd） | `starry-identity` |
