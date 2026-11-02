# Starry 平台｜開發規則

本 Repo 是 Starry 平台的後端：Starry ID（會員與登入）、App Registry、購買權益投影、Starry Battery、通知、客服與 Admin Lite，部署在 Cloudflare Workers。

## 規格與決策來源

- 唯一規格：[H-Global × Starry 開發主規格 v2.0｜開發清單與技術架構](https://docs.google.com/document/d/1bKhdZO-NsgKEUCeut-8vNp1lLea6iIIkvn_-cKqAadM/edit)。項目編號（S-ID-01、S-PLT-03 等）以該文件為準。
- 刪除與修正紀錄：[開發主規格 v2.0｜刪除與修正紀錄](https://docs.google.com/document/d/1G22CRm8Mod9vd_r8xUW4fyS1fgYaT-n6cp7-GHKXV-M/edit)。
- 實作層面的決定寫在 `docs/adr/`。
- 工程進度以 GitHub 為準：PR、commit、CI、部署紀錄，以及交接 Issue [#220](https://github.com/starry-phd/id/issues/220)。

2026-11-03 業主授權刪除舊程式、依 v2.0 重新開發。舊的五 AI 分工、AI-0～AI-4 角色、G00～G10 發布閘門與相關文件已移除，只保留在 Git 歷史中（重建前最後一個 commit：`219223f5b44c24b1ad44aeb1393d8b8fdb28e895`）。

## 開發方式

- 單一開發者：Claude。業主負責產品方向、外部平台操作與下列核准事項。
- 每項工作：分支 → PR → CI（Repository policy、App typecheck, lint and tests、Required validation）全綠 → squash 合併 → 確認 main 的 CI 與部署結果 → 回寫 #220。
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

## 本機指令

```bash
npm install
npm run check    # typecheck + lint + 打包 + 本機 workerd/D1 測試
npm run dev      # wrangler dev（staging 設定，本機 D1）
```
