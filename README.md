# Starry 平台 API

Starry ID 與 Starry 平台服務，部署在 Cloudflare Workers。規格與開發規則見 [AGENTS.md](AGENTS.md)。

| 路由 | 說明 |
|---|---|
| `GET /v1/health` | 服務狀態與 D1 連線檢查 |
| `GET /v1/apps/{app_id}/config` | App 啟動時讀取的狀態、最低版本與白名單設定 |

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
| staging | `starry-api-staging` | `starry-identity-staging` |
| production | `starry-api` | `starry-identity` |
