# ADR 0011：所有 App 登記在資料庫，`config/apps.json` 只留登入中樞

日期：2026-11-07｜狀態：業主核准（內部測試資料，可重置；兩款 App 尚未對外發布）。取代 ADR 0010。

## 決定

- `echo`、`recordnote` 與日後所有 App 一樣，登記在 `registered_apps`，由 Admin Lite 新增與編輯；新增 App 不必改 GitHub。
- `config/apps.json` 只留登入中樞 `account`：它是登入流程本身，固定在檔案，後台不可改。
- 移除內建覆寫機制（`builtin_app_overrides`、`/admin/apps/:id/builtin`）：只有一種登記方式，沒有「檔案＋覆寫」兩層。
- Apple Team ID 全生態系共用（Worker 變數 `STARRY_APPLE_TEAM_ID`）；Android 簽章指紋每款 App 各自登記，可首次登記時填、也可日後補填。
- 編輯登記資料需要 Passkey 二次確認（可能改變誰能登入）。

## 切換方式（沒有空窗）

Deploy 先套用 migration 0028 再部署程式：舊程式還把兩款 App 放在檔案裡，會忽略資料庫中同代碼的列；新程式啟動後直接讀資料庫。資料用 `INSERT OR IGNORE` 寫入，不覆蓋既有列。回復：還原上一版程式即可（舊程式只看檔案）；兩列資料留著無害。

## 取捨

- 資料庫整個讀不到時，這兩款 App 會暫時無法辨識。ADR 0010 當時為此保留檔案備援；但每個需登入的請求本來就要查 D1 的 sessions，備援的實際價值低，業主選擇單一來源。
- 冷啟動：第一次讀取完成前，所有請求等同一次讀取（`loaded`／`inflight`），避免「未知 App」。
- 單列登記壞掉：沿用上一次正常的定義並在後台警示（不是整個 App 消失）。
- 測試：單元測試以預載夾具提供這兩款 App；整合測試經由 migration 取得。
