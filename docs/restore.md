# 資料還原手冊（S-PLT-08）

**正式環境的還原一律要業主核准**（規格「必須先取得業主核准：刪除或還原正式資料」）。還原會讓還原時間點之後的寫入全部消失（登入、資料修改、Battery、購買投影），所以只在資料毀損或錯誤 migration 時使用。

## 備份來源

| 來源 | 內容 | 保存 |
|---|---|---|
| D1 Time Travel（主要） | identity、billing、battery 三個資料庫，可還原到任一分鐘 | Workers Paid 方案 30 天 |
| 每週匯出（`Weekly D1 backup` 工作流程） | 三個正式資料庫的 SQL 匯出，存在私有 R2 `starry-backups` | 直到手動刪除 |

## 演練（staging）

高風險 migration（刪欄、改表、大量更新）合併前，先到 GitHub → Actions →「Restore drill (staging)」→ Run workflow。流程會對三個 staging 資料庫各做一次：取得 Time Travel 書籤 → 寫入一筆標記 → 還原到書籤 → 確認標記消失、筆數一致、staging 健康檢查通過。結果顯示在該次執行的 Summary。

## 正式環境還原步驟（業主核准後由 Claude 執行）

1. 在交接 Issue 記錄：原因、要還原的資料庫、還原到的時間（台灣時間）、業主核准的留言。
2. 先在 Admin Lite →「App 狀態」把受影響的 App 設為 paused，避免還原過程中有新寫入。
3. 查詢書籤：`npx wrangler d1 time-travel info starry-identity --timestamp=<UTC ISO 時間>`。
4. 還原：`npx wrangler d1 time-travel restore starry-identity --bookmark=<書籤>`。還原會回傳「還原前的書籤」，記在 Issue 中；若還原錯了，可以用它再還原回去。
5. 確認 `https://id.starry.phd/v1/health` 為 ok，抽查會員資料與稽核紀錄。
6. App 狀態改回 active，在 Issue 記錄結果。

Time Travel 超過 30 天或無法使用時，改用 R2 的每週匯出：先在 staging 匯入驗證，再經業主核准匯入正式環境；這會遺失匯出之後的所有資料。
