# 0005｜Starry Battery 與 RevenueCat 每日對帳

日期：2026-11-03｜狀態：已採用

## 背景

規格 S-BAT-07 原訂「第一款會呼叫付費 AI 服務的 App 開工時才實作 Battery」。業主 2026-11-03 指示一次完成所有開發清單，因此提前實作；S-BAT-01～06 的規則不變。S-BIL-04 的每日對帳原本等待 RevenueCat API Key（ADR 0004），現在先完成程式，有 Key 的 App 自動納入。

## Battery 決定

- 獨立 D1 `starry-battery`（staging：`starry-battery-staging`），只有 `src/battery` 寫入（S-BAT-06、架構原則 4）。
- 月份以台灣時間計算（`YYYY-MM`），每月 1 日 00:00 恢復；帳戶在新月份第一次被寫入時才重置，不需要月初批次（規格資料庫說明）。讀取不寫入。
- 防止超扣：`battery_accounts` 有 `CHECK (used + reserved <= allowance)`。預留、建立預留紀錄與更新帳戶在同一個 D1 batch（交易）中執行，額度不足時整批失敗、不留下任何變更，並發請求也不會超扣。
- 冪等：預留以 `(app_id, idempotency_key)` 唯一；確認／釋放以 `op_id` 標記關閉該筆預留的請求，只有它會異動額度，重送不會重複扣除或歸還。
- 逾時：預設 3 分鐘（全站設定）；每分鐘 Cron 以集合式更新釋放逾時預留。逾時後才送達的確認回 409 `RESERVATION_EXPIRED`，不扣額度。
- 消耗量（2026-11-07 改版）：由各 App 自己決定每個任務扣幾顆，預留時直接送顆數（全站單次上限 100）；中央不再登記任務類型。確認時可帶實際顆數（不超過預留），差額歸還。
- 跨月的進行中預留會保留到新月份，在新月份確認時計入新月份。
- Owner 修改每月額度時，本月所有帳戶同步增減（不低於已用＋預留），新帳戶直接取得新額度；個別會員的人工調整只影響當月，必填原因，寫入帳本與稽核，並寄只寫項目的通知信（S-NTF-02）。
- 只有 App 後端能操作：服務金鑰放在 Worker Secret `BATTERY_SERVICE_KEYS`（每款 App 一把、32 字以上）；預留同時要求同一 App 的會員 Access Token，確保會員已登入該 App 且未被停權。確認／釋放只需服務金鑰，因為 AI 任務結束時會員 Token 可能已過期。
- 帳本只新增（觸發器擋下 UPDATE），保留 1 年；已結束的預留保留 35 天（冪等鍵的有效期）。刪帳期滿時刪除該會員所有 Battery 資料（S-ID-06）。

## 對帳決定

- RevenueCat v1 API 沒有列出全部客戶的端點，因此對象為「曾有權益投影或購買事件的會員 × App」，每天依上次比對時間由舊到新處理最多 200 組，所有買家會在數天內輪過一次。
- 以 RevenueCat 的 CustomerInfo 為準覆寫投影：到期與寬限期依 `expires_date`／`grace_period_expires_date`，`expires_date` 為 null 視為永久買斷。RevenueCat 已不認得的權益關閉。
- 查詢失敗不修改投影（不因暫時錯誤撤權）；遇到 429 停止當次執行，隔天繼續。
- `GET /v1/subscribers/{id}` 在 RevenueCat 不存在該客戶時會建立客戶，所以只查詢已知買家，不查詢已刪除的會員。

## 影響

- 新增每分鐘 Cron（Workers Paid 已核准）。
- 每週備份改為匯出 identity、billing、battery 三個 D1。

## 2026-11-03 補充

- 每月預設額度改為 10 顆（業主指定）。以 migration `battery/0002` 調整：只在設定從未被 Owner 修改過時生效，本月帳戶同步減少但不低於已用＋預留。之後由 Owner 在 Admin Lite 自行調整。

## 帳號合併（S-ID-02 修正，業主 2026-11-03 要求）

先用 Google、再另外用 Apple 登入的人會有兩個 Starry 帳號，原規則「已屬於其他會員的身分不可綁定」讓他無法加綁。改為：在目前帳號加綁時完成另一種登入（證明兩者都是本人），若那個登入方式屬於另一個帳號，可以確認後合併。

- 合併內容：登入方式與其 Apple Token 移到目前帳號；另一個帳號的客服單移過來；其餘（個人資料、同意紀錄、推播 Token、登入中的裝置、Battery 紀錄、頭像）刪除。稽核寫 `account.merged.<provider>`。
- 不合併的情況（請會員聯絡客服）：另一個帳號有購買紀錄（RevenueCat 以會員 ID 記錄購買，需人工轉移）、是管理人員、已停權（避免以合併規避停權）、還有其他登入方式；或目前帳號已有同類型的另一個登入。
- 網頁：加綁失敗時回傳以 `DATA_ENCRYPTION_KEY` 加密、10 分鐘有效的合併單（頁面看不到另一個帳號的會員 ID），會員按「合併帳號」才執行，且需 10 分鐘內登入過。App：`POST /v1/me/identities/{provider}` 回 409 `mergeable`，App 詢問會員後帶 `merge_other_account: true` 重送。
- 一致性：同一個 D1 交易中先標記另一個帳號（僅在它仍持有該登入方式時），最後只刪除被這次標記的帳號；狀態在中途改變時什麼都不做。
