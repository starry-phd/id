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

只解析 #291 的六個 DTO 欄位 request_id、status、first_confirmed_at、second_confirmed_at、physical_erasure_completed:false、execution_authorized:false；限定兩種狀態 awaiting_second_confirmation/pending_processing。錯 ID、額外 PII 欄位、physical true、奇怪時間戳、cacheable/mislabelled/超 4KB/重導回應一律 fail closed，回應 body 不反射。所有請求 credentials=omit、redirect=error、cache=no-store，401/403→未授權、503/網路→可安全重試、GET 404→無申請。**AI-0 真缺陷修正後：** 首次/第二次 POST 回應丟失的重試會先 GET 查本人權威申請狀態；若 GET 已返回 awaiting_second_confirmation，只顯示第二次不同按鈕，**不得自動做第二次**；若已 pending_processing，顯示尚在處理、不重送 POST。只有第一次 POST 且 GET 明確 404/no-request 才可按原意圖重送第一步；第二次 POST 舊 ID 查無狀態不可盲重送。

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

## 5. AI-0 PR #293 初版獨立重現缺陷：真修補及重現證據

- [AI-0 PR 初版 review](https://github.com/starry-phd/id/pull/293#issuecomment-6519031906) 的三個問題已針對原 source 修補，不拆分另一份 PR：401/403 或 Session source 失效 **清除 receipt/intent、封鎖所有 retry/confirm**，等待新 Auth-Owner 提供不同 port/flow；React 透過 useSyncExternalStore 立即讀新 port 狀態，舊 port invalidation epoch 抑制晚到 async 內容。
- SDK 僅接受 status 404 同時滿足 **application/json、cache-control:no-store、bounded exact `{error:{code:"NO_REQUEST"}}`** 時才返回 null，HTML 404、NOT_FOUND、額外 PII、可快取及超大 response 都視為錯誤，不顯示「沒有申請」。
- 首次或第二次 POST 模糊網路結果 retry **必先 GET**，新增呼叫順序與真回應丟失模擬。復原收到 `awaiting_second_confirmation` 絕不自動執行後續第二確認，收到 `pending_processing` 僅顯示待處理。
- **訂閱提醒置於兩次確認操作之前**，使用者不必先按確認才看到重要資訊。正式 build 不連線或取得 fixture token，dev-only preview 仍只有記憶體狀態。
- 驗證證據區分：React Native Web SSR 確認真元件排版與文字；Node flow/SDK 測試真正呼叫實作函式、驗證操作和 HTTP 序列；Expo dev preview 由審查者本機手動點按。**尚無瀏覽器手勢 E2E 或 iOS/Android 物理裝置點按證據，不冒稱已做此級驗收**。

## 6. AI-0 React19 StrictMode 真元件實測缺陷與修正

AI-0 [Review #6519162887](https://github.com/starry-phd/id/pull/293#issuecomment-6519162887) 使用 React19 createRoot + StrictMode + 真 AccountDeletionScreen + scratch jsdom26 發現：setup→cleanup→setup 後按鈕顯示但按下第一次確認不呼叫 POST1。原因是 memoized flow 在 cleanup 被永久 invalidate，第二次 setup 未重新啟用。

本 PR 新增 flow.activate()，每次 React effect setup 重新啟用**同一受信任 port** 的全新 epoch；cleanup **繼續 invalidate** 舊請求與畫面，避免異步舊結果覆蓋換人的狀態。useSyncExternalStore 訂閱允許在 StrictMode cleanup 與第二次 setup 之間註冊；如 Auth port identity 改變，React useMemo 立即產生獨立空白 flow。

新增 Node 真 flow source 回歸：GET→GET→第一次按鈕對應的 POST1、舊 GET 晚到不得覆蓋第二代畫面、replay 提前訂閱不遺失。**本次回歸是控制器的實際呼叫測試，不冒充 jsdom/Chrome/iOS/Android 實際按鈕 click 測試**。React Native Web SSR 只證實元件畫面文字；實際 createRoot StrictMode 点击還需 AI-0 使用其原先獨立 jsdom 腳本，在本 PR 的**最終 exact HEAD** 再次執行，確認紅→綠；不得用 SSR 取代此證據。
