# AI-4｜M2 會員刪帳手機介面／Typed Client／可操作預覽驗收

狀態：Source-only，development preview，僅供 AI-0 review，尚未合併或部署。權威：[AI-0 工作令 #6518777582](https://github.com/starry-phd/id/issues/5#issuecomment-6518777582)、[總管 #220](https://github.com/starry-phd/id/issues/220)、[最新 Google S2 規範](https://docs.google.com/document/d/1urLja9i9A63jHuz4jQPhPMTgoCtoq-i1TafXPQd3PYU)、已合併 [AI-1 #291](https://github.com/starry-phd/id/pull/291)。

## 1. 真實畫面與本機互動證據

Expo Router 畫面：**/account-deletion**；首頁有「體驗刪帳申請流程（僅本機預覽）」。保持 Expo 54／RN 0.81／Expo Router 6，沒有新增原生依賴。於 repo 根目錄 npm ci，再執行 npm run web:dev，打開開發 Web 的首頁連結，以手機寬度查看。

真畫面來源：apps/mobile/src/account-deletion-screen.tsx。開發模式才注入 **完全記憶體內的可操作 preview port**，不含任何 bearer/token，**不連線、不呼叫 Google/Worker/D1、不會真刪帳**。正式 App 路由則注入刻意停用的 port，不能偷偷呼叫 SDK、API、甚至注入測試憑證。本 PR 並**沒有**正式登入 Session Provider。畫面醒目標示「本機操作演示，不會送出真實刪帳申請」。

| 介面狀態 | 使用者可操作動作 | 畫面驗收 |
| --- | --- | --- |
| 進入 | 查詢申請進度 | 尚無申請紀錄；看到兩階段提醒 |
| 第一次 | 「第一次確認：我要提出刪帳申請」 | 只得到 awaiting_second_confirmation，不能當已完成刪除 |
| 第二次 | 「第二次確認：確認送出刪帳申請」 | pending_processing；顯示「申請已收到，尚在處理中」 |
| 再查詢 | 查詢申請進度 | 仍維持同一筆本機申請，不重建 request_id |
| 503 模擬 | 「模擬下次服務暫時無法使用」 | 錯誤說明、可重試；之前 receipt 不遺失 |
| 401 模擬 | 「模擬下次登入失效」 | 清楚提示登入失效，不暴露 Session、SQL 或後端 gate 語言 |
| 商店提醒 | 訂閱提醒文字 | 如 Apple App Store 或 Google Play 有訂閱，申請刪帳**不會自動取消訂閱**，需自己在原商店管理；沒有虛構商店管理連結 |
| 正式 build | 禁用來源 | 不接 fake bearer、真 OAuth、雲端、付費與任何未核准的資料刪除 |

**實際畫面渲染證據：** apps/mobile/test/account-deletion-native-web-render.test.mjs 使用 esbuild + 專案已安裝的 React / React Native Web 真實渲染 AccountDeletionScreen，直接斷言標題、按鈕、訂閱提醒、development banner。這是**真元件 SSR HTML 斷言**，不是繪圖 mock 或模擬器螢幕截圖；不得用它冒充手機原生裝置驗收。使用者可在上述 Expo 本機 Web 預覽互動。

## 2. 與 #291 對齊的 typed client，預設停用

packages/sdk/src/m2-local-deletion-request-client.ts **不從 public SDK index 匯出、預設 enabled=false、不接正式 App**；由未來 AI-1 受審 Auth runtime 提供每次操作才讀取的 volatile signed bearer（不使用 AsyncStorage、localStorage 或 route params 保存 token）。

與已合 #291 相同的三個 API，未新增公開 Worker route：

| 方法 | Path | Request |
| --- | --- | --- |
| POST | /v1/starry-id/members/me/deletion-requests | confirmation = REQUEST_MY_ACCOUNT_DELETION |
| POST | /v1/starry-id/members/me/deletion-requests/confirm | confirmation = CONFIRM_MY_ACCOUNT_DELETION；帶第一步 receipt request_id |
| GET | /v1/starry-id/members/me/deletion-requests/status | 查本人狀態，404 表示尚無 request |

只解析 #291 的六個 DTO 欄位 request_id、status、first_confirmed_at、second_confirmed_at、physical_erasure_completed:false、execution_authorized:false；限定兩種狀態 awaiting_second_confirmation/pending_processing。錯 ID、額外 PII 欄位、physical true、奇怪時間戳、cacheable/mislabelled/超 4KB/重導回應一律 fail closed，回應 body 不反射。所有請求 credentials=omit、redirect=error、cache=no-store，401/403→未授權、503/網路→可安全重試、GET 404→無申請。第一步失敗後可再送同種確認（後端冪等），第二步失敗保留同 request_id 後再確認。

後端 #291 只**受理刪帳申請**，並不撤銷所有 Session、執行實體刪除、取消商店訂閱、恢復購買權益、處理 Q104/Q119 法定保留與 PITR。不得把 pending 說成 physical erased。

## 3. 完整使用者操作流程（Mermaid）

flowchart:
1. 進入畫面先呼叫本人狀態查詢；無申請則顯示第一步。
2. 第一按鈕確認後，收到 awaiting_second_confirmation，才顯示另一顆第二確認按鈕。
3. 第二按鈕需同一 opaque request_id；收到 pending_processing 只顯示尚在處理。
4. 401 顯示需重新登入；503 顯示重試。Busy 中鎖定快速多次點擊，保留原 receipt；查詢可以恢復中斷狀態。

測試：apps/mobile/test/account-deletion-mobile-flow.test.mjs 驗證兩不同操作、busy lock、模糊網路錯誤/重試、401、pending 非實體刪除、DEV-only route；packages/sdk/test/m2-local-deletion-request-client.test.mjs 驗證三 API 與兩確認 payload、所有否定 cases、4KB stream/cancel、安全憑證來源、轉址/快取拒絕；apps/mobile/test/account-deletion-native-web-render.test.mjs 驗證真 UI 元件畫面文字。既有 AI-1 13+3 核心測試不重做。

## 4. 下一手 AI-0 和 Owner 定向審閱

- AI-1：核對 #291 確切 DTO/HTTP statuses/兩段權限及未來 volatile Session Provider；不重寫登入、SQL、D1。
- AI-2：確認商店訂閱提示與 S2-11 的購買權益恢復未決，不添加自動移轉、假管理網址。
- AI-3：確認 pending 非刪除完成，繼續保留 Q104/Q119、實體刪除/Audit FK/anti-PITR 等 blocker。
- AI-0：核對此切片 UI + SDK + preview tests 的同 SHA CI 和實際介面預覽。未來實接真 Auth 要有受審 provider/bootstrap；目前不公開 Worker 會員路由、不部署、不改資源/付費/Gates。

本切片絕不聲稱已做 physical erasure、真 Google OAuth、remote D1/Store 或上架。正式發布仍受 11 Gate 與業主環境權限限制。
