# ADR 0012：全生態系 Apple Team ID 儲存於中央 D1

日期：2026-11-07｜狀態：PR 提案，尚未部署

## 決定

- 全生態系只有一個 Apple Developer Team ID。新增 identity migration 0029，以 `platform_settings` 的 `apple_team_id` 一列持久化業主確認的 `4W7QRTXN5Y`。
- Owner 在 `/admin/apps/status` 以單一表單修改；需使用既有員工 Passkey 二次確認，變更及操作者寫入 security 稽核。一般 App 管理員、客服、會員不得修改。
- Worker 啟動請求前載入此 D1 值，30 秒內快取。D1 暫時失敗維持上次有效值；首次不可讀時，既有 `STARRY_APPLE_TEAM_ID` 僅作應急備援，**正常狀況 D1 一律優先**。Signing in with Apple 撤銷憑證用的 Secret `APPLE_TEAM_ID` 完全不變。
- 所有 App 的 AASA / 整合狀態 / 串接指令統一採此值；舊 App 個別的 `ios_team_id` 不再優先。migration 只將有效 JSON 中的舊個別 Team ID 欄位設為 null；不更動任何其他登記欄位。
- Android SHA-256 照原方案每 App 各自存放多組，新增時可留白並於後台補登；缺少時仍標示 Android Passkey 未完成。
- App 編輯時保留狀態、scopes、config；修改既有 iOS Bundle ID／Android package 需要輸入 app_id 再確認，已上架階段一律拒絕。

## 安全遷移／回復

1. 先備份並比對 staging 的 `registered_apps`、`platform_settings`、`app_status_overrides`、`app_config_overrides` 和 Echo／RecordNote 主要 OAuth／CORS／redirect 欄位。已合併的 migration 0028 已將兩款 App 統一登記於 D1，本 PR **不重新插入、不刪除 App**。
2. staging 上先套用 0029，確認 central Team ID、兩款 App 登記及 AASA 一致，再部署候選 Worker。用 local workerd CI 檢查 AASA、assetlinks、CORS、App config、登入、Passkey、JWKS、Battery、Billing；實機 Passkey 需另測。302 與 DNS 不改。
3. **未經業主另行授權，不執行上述 staging／production 操作以外的任何正式變更，尤其不合併 main、不執行 Deploy。** 本 PR 僅保留程式碼與本機測試。
4. 若發現問題：停止發佈、還原上一版 Worker 程式；0029 新表保留並不影響上一版。若必要需將某一 App 的舊 Team ID 設回，先由備份核對再個別處理；不得直接回復整個正式 D1 或覆寫會員。
5. AASA 公開快取最多 300 秒，Owner 修改後需驗證該檔新值（iOS 系統快取可能更久）。

未提供 Android 真正簽章憑證的 App，不能宣稱 Android 原生 Passkey 已可用。
