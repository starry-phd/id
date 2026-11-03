# Starry 平台｜開發規則

本 Repo 是 Starry 平台的後端：Starry ID（會員與登入）、App Registry、購買權益投影、Starry Battery、通知、客服與 Admin Lite，部署在 Cloudflare Workers。

## 規格與決策來源

- 唯一規格：[H-Global × Starry 開發主規格 v2.0｜開發清單與技術架構](https://docs.google.com/document/d/1bKhdZO-NsgKEUCeut-8vNp1lLea6iIIkvn_-cKqAadM/edit)。項目編號（S-ID-01、S-PLT-03 等）以該文件為準。
- 刪除與修正紀錄：[開發主規格 v2.0｜刪除與修正紀錄](https://docs.google.com/document/d/1G22CRm8Mod9vd_r8xUW4fyS1fgYaT-n6cp7-GHKXV-M/edit)。
- 實作層面的決定寫在 `docs/adr/`。
- 工程進度以 GitHub 為準：PR、commit、CI、部署紀錄，以及本 Repo 的交接 Issue（Repo 重建後開立的第一個 Issue）。

2026-11-03 業主核准 v2.0，並自行刪除舊 Repo 與 Cloudflare 上的舊資源，授權 Claude 從零重建。本 Repo 的歷史從重建開始；舊的五 AI 分工、AI-0～AI-4 角色、G00～G10 發布閘門都不再適用。

## 開發方式

- 單一開發者：Claude。業主負責產品方向、外部平台操作與下列核准事項。
- 每項工作：分支 → PR → CI（Repository policy、App typecheck, lint and tests、Required validation）全綠 → squash 合併 → 確認 main 的 CI 與部署結果 → 回寫交接 Issue。
- 合併到 main 後，Deploy workflow 自動執行：staging 套用 migration、部署、smoke test，通過後同樣流程部署 production，production smoke 失敗自動回滾。
- 只有一款 App 用到的程式不放這裡；放在該 App 的 Repo。

## 必須先取得業主核准

- 付費方案、升級或可能產生額外費用的操作。
- App Store／Google Play 送審與正式發布。
- 刪除或還原正式資料；刪除 Cloudflare、GitHub 上的既有資源。
- 啟用廣告、真實金流。
- 建立新的雲端或商店帳號。

## 安全

- 這是公開 Repo：不提交 token、金鑰、`.env`、`.dev.vars`、Cloudflare 帳戶 ID、真實會員資料或測試者名單。Secrets 只放 Workers Secrets、GitHub Actions Secrets 或 EAS Secrets。
- 每個請求在後端驗證身分、app_id、角色與資料擁有權；畫面隱藏按鈕不算權限控制。
- 會員只以「provider＋sub」辨識，不以 Email 或姓名合併。
- 稽核紀錄不存 Token、秘密與個資原文。

## 範圍

- 只做 Starry。H-Global 依規格暫停（階段 H），Starry 與 H-Global 不共用帳號、資料庫或 Secrets。
- Starry Battery 永遠免費，任何付款都不得增加 Battery；廣告預設關閉。

## 測試

- `test/*.test.mjs`：整合測試，`wrangler deploy --dry-run` 打包後在本機 workerd＋D1＋R2（Miniflare）執行，涵蓋所有 HTTP 路由。
- `test/unit/*.test.ts`：領域邏輯單元測試，`src/identity`、`src/billing`、`src/notify`、`src/support` 等不依賴 Hono 的模組，以 `node:sqlite` 版 D1 替身跑真正的 migration。新的資料規則優先寫成這類模組並加單元測試。
- 每個新資料表都要更新 `test/migrations.test.mjs` 的資料表清單。

## API 契約（S-PLT-03）

- 所有 `/v1` 路由用 `@hono/zod-openapi` 的 `createRoute` 宣告；請求以同一份 zod schema 驗證，回應型別由 TypeScript 檢查。
- 改了路由就執行 `npm run openapi` 並提交 `openapi/starry-id.v1.json`；CI 會檢查文件是否最新，並以 oasdiff 擋下破壞性變更。
- 破壞性改版走 `/v2`，與 `/v1` 並存到所有 App 更新完成。

## 本機指令

```bash
npm install
npm run check      # typecheck + lint + 打包 + workerd 整合測試 + 單元測試
npm run test:unit  # 只跑單元測試
npm run dev        # wrangler dev（staging 設定，本機 D1）
```

## 尚未完成（依序）

1. App 接入：每款 App 在 `config/apps.json` 登記（Bundle ID、Android package、Google iOS／Android Client ID），Apple App ID 掛到群組主 App ID `phd.starry.app`；App 端以 `openapi/starry-id.v1.json` 產生型別。串接方式見 `docs/integration-guide.md`。
2. 業主外部設定：`docs/owner-setup.md`。
3. 依需求再做：Battery（S-BAT，第一款付費 AI App 開工時）、系統 Email（S-NTF-02，需客服信箱與寄信服務）、RevenueCat 每日全量對帳。
