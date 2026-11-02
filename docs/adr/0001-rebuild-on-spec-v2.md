# ADR 0001：依規格 v2.0 重建 Starry 平台

日期：2026-11-03｜狀態：已採用

## 背景

業主於 2026-11-03 核准《H-Global × Starry 開發主規格 v2.0》，取消多 AI 分工，並授權依 v2.0 重新開發。舊程式（ChatGPT 五 AI 時期）只有 `GET /v1/health` 曾可部署，登入、會員與刪帳都停在 source-only，且綁著 G00～G10 發布閘門與大量治理文件。同日業主自行刪除舊 Repo `starry-phd/id` 及 Cloudflare 上的舊 Worker 與 D1。

## 決定

1. 從零重建：Git 歷史從重建開始，不帶入舊程式。
2. 本 Repo 只放 Starry 平台後端與網頁（Web 帳號中心、Admin Lite），不包含 Expo App。Starry ID 不單獨上架（規格 C-06），App 端登入畫面放在各 App。
3. 技術：Cloudflare Workers＋TypeScript strict＋Hono；每個資料領域一個 D1（目前 `DB_IDENTITY`）；App Registry 來自 `config/apps.json`，在打包時驗證。
4. 測試：以 `wrangler deploy --dry-run` 打包出與正式相同的 bundle，再用 Miniflare（本機 workerd）與記憶體 D1 執行整合測試，migration 以正式檔案逐條套用。規格技術棧列的 Vitest＋Workers 測試池暫不採用，避免 Vitest 與 pool 版本綁定；測試行為相同（真實 workerd＋D1），之後如有需要再換。
5. 部署：合併到 main 後，Deploy workflow 依序處理 staging 與 production（migration、部署、smoke test、production 失敗自動回滾）。需要 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 兩個 Repo secrets；未設定前 workflow 只會跳過。
6. D1 於 2026-11-03 重新建立（APAC）：`starry-identity`、`starry-identity-staging`。

## Repo 建立經過

重建當晚開發環境無法建立新 Repo，也不能推送到其他 Repo，程式先以 Git bundle 備份。業主於 2026-11-03 建立空白的 `starry-phd/id` 後，第一個 commit 推為 `main`，其餘工作以 PR 合併。
