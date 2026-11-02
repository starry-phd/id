# ADR 0001：依規格 v2.0 重建 Starry 平台

日期：2026-11-03｜狀態：已採用

## 背景

業主於 2026-11-03 核准《H-Global × Starry 開發主規格 v2.0》，取消多 AI 分工，並授權刪除舊程式、依 v2.0 重新開發。舊程式（ChatGPT 五 AI 時期）只有 `GET /v1/health` 曾可部署，登入、會員與刪帳都停在 source-only，且綁著 G00～G10 發布閘門與大量治理文件。

## 決定

1. 從空白重建：刪除全部舊檔，舊內容只保留在 Git 歷史（重建前 commit `219223f5b44c24b1ad44aeb1393d8b8fdb28e895`）。
2. 本 Repo 只放 Starry 平台後端，不再包含 Expo App。Starry ID 不單獨上架（規格 C-06），登入與帳號畫面放在各 App 的共用元件。
3. 技術：Cloudflare Workers＋TypeScript strict＋Hono；每個資料領域一個 D1（目前 `DB_IDENTITY`）；App Registry 來自 `config/apps.json`，在打包時驗證。
4. 測試：以 `wrangler deploy --dry-run` 打包出與正式相同的 bundle，再用 Miniflare（本機 workerd）與記憶體 D1 執行整合測試，migration 以正式檔案逐條套用。暫不採用 `@cloudflare/vitest-pool-workers`，避免 Vitest 與 pool 版本綁定；測試數量成長後再評估。
5. 部署：合併到 main 後，Deploy workflow 依序處理 staging 與 production（migration、部署、smoke test、production 失敗自動回滾）。需要 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 兩個 Repo secrets；未設定前 workflow 只會跳過。
6. OpenAPI：在加入第一批需要客戶端串接的路由（登入）時，以 `@hono/zod-openapi` 從程式碼產生，並加入 oasdiff 檢查（規格 S-PLT-03）。

## 影響

- Required status checks 名稱維持「Repository policy」與「Required validation」，main 的保護規則不需要更改。
- 舊 Issue 與 Draft PR 留作歷史；不再依其內容派工。
