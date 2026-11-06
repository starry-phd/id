# 0007：Owner 在後台自行登記新 App

日期：2026-11-06

## 背景

`config/apps.json` 是 App 登記的唯一來源，每多一款 App 都要改檔案、發 PR、跑 CI、部署。業主希望新增 App 時不必改程式碼，並且能把串接資料一次交給負責開發該 App 的 AI。

## 決定

- 新增資料表 `registered_apps`（identity D1），欄位 `definition` 是與 `config/apps.json` 單筆相同的 JSON，寫入與讀取時都用同一個 `parseApp` 驗證。
- `config/apps.json` 仍是既有 App 的來源，app_id 衝突時它優先；`account` 保留給帳號中心，不能被登記。
- Worker 以全域 middleware 每個 isolate 最多每 30 秒重新載入一次後台登記的 App（與 App 狀態 kill switch 同一個時間窗），排程工作開始時也會載入。載入失敗或單列資料不合格時略過，不影響 `config/apps.json` 的 App。
- `appRegistry` 改為同時涵蓋兩個來源的唯讀檢視，呼叫端不需要改成非同步。CORS 允許來源也由此即時計算。
- 登記頁面（`/admin/apps/new`、`/admin/apps/:id/edit`）限 Owner、需 10 分鐘內登入、寫入稽核紀錄（`admin.app_registered`／`admin.app_updated`）。串接指令頁 `/admin/apps/:id/handoff` 限 Admin 以上。
- 新 App 預設接受帳號中心的 Apple Services ID 與 Google 網頁用戶端，所以 iOS、Android、網頁三個平台都走 Starry 登入中繼（2026-11-06 業主決定），不必再向 Apple、Google 登記任何東西。
- 串接指令只含公開資料，不含任何金鑰；它要求開發 AI 在 starry-phd 組織以 app_id 建立 Repo 與 Worker，並把需要業主的事項列出回報。

## 後果

- 只有改用原生登入時才需要外部設定：Apple App ID 群組、Google 的 iOS／Android 用戶端；串接指令預設禁止開發 AI 自行改用原生登入。
- 後台不能刪除登記的 App（刪除既有資源需業主核准）；要停用用 App 狀態 killed。
- Battery 服務金鑰（`BATTERY_SERVICE_KEYS`）與 RevenueCat Secrets 仍是 Workers Secrets，無法由後台頁面設定。
