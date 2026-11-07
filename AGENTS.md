# Starry 平台｜開發規則

本 Repo 是 Starry 平台的後端：Starry ID（會員與登入）、App Registry、購買權益投影、Starry Battery、通知、客服與 Admin Lite，部署在 Cloudflare Workers。

## 規格與決策來源

- 唯一規格：[H-Global × Starry 開發主規格 v2.0｜開發清單與技術架構](https://docs.google.com/document/d/1bKhdZO-NsgKEUCeut-8vNp1lLea6iIIkvn_-cKqAadM/edit)。項目編號（S-ID-01、S-PLT-03 等）以該文件為準。
- 刪除與修正紀錄：[開發主規格 v2.0｜刪除與修正紀錄](https://docs.google.com/document/d/1G22CRm8Mod9vd_r8xUW4fyS1fgYaT-n6cp7-GHKXV-M/edit)。
- 實作層面的決定寫在 `docs/adr/`。
- 工程進度以 GitHub 為準：PR、commit、CI、部署紀錄，以及本 Repo 的交接 Issue（Repo 重建後開立的第一個 Issue）。

2026-11-03 業主核准 v2.0，並自行刪除舊 Repo 與 Cloudflare 上的舊資源，授權 Claude 從零重建。本 Repo 的歷史從重建開始；舊的五 AI 分工、AI-0～AI-4 角色、G00～G10 發布閘門都不再適用。

## 開發方式

- 單一開發者：Claude。業主負責產品方向、外部平台操作與下列核准事項。
- 每項工作：分支 → PR → CI（Repository policy、App typecheck, lint and tests、Required validation）全綠 → squash 合併 → 確認 main 的 CI 與部署結果 → 回寫交接 Issue。
- 高風險 migration（刪欄、改表、大量更新）合併前，先執行「Restore drill (staging)」並在 PR 附上結果（`docs/restore.md`）。
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

## 測試

- `test/*.test.mjs`：整合測試，`wrangler deploy --dry-run` 打包後在本機 workerd＋D1＋R2（Miniflare）執行，涵蓋所有 HTTP 路由。
- `test/unit/*.test.ts`：領域邏輯單元測試，`src/identity`、`src/billing`、`src/notify`、`src/support` 等不依賴 Hono 的模組，以 `node:sqlite` 版 D1 替身跑真正的 migration。新的資料規則優先寫成這類模組並加單元測試。
- 每個新資料表都要更新 `test/migrations.test.mjs` 的資料表清單。

## API 契約（S-PLT-03）

- 所有 `/v1` 路由用 `@hono/zod-openapi` 的 `createRoute` 宣告；請求以同一份 zod schema 驗證，回應型別由 TypeScript 檢查。
- 改了路由就執行 `npm run openapi` 並提交 `openapi/starry-id.v1.json`；CI 會檢查文件是否最新，並以 oasdiff 擋下破壞性變更。
- 破壞性改版走 `/v2`，與 `/v1` 並存到所有 App 更新完成。

## 本機指令

```bash
npm install
npm run check      # typecheck + lint + 打包 + workerd 整合測試 + 單元測試
npm run test:unit  # 只跑單元測試
npm run dev        # wrangler dev（staging 設定，本機 D1）
```

## 尚未完成（依序）

規格 v2.0 中屬於本 Repo 的開發項目已全部完成並部署（2026-11-03；Battery 依業主同日指示提前完成，不等 S-BAT-07 的觸發條件）。其餘為外部或其他 Repo 的工作：

1. App 接入：新 App 由 Owner 在 Admin Lite（`/admin/apps/new`）登記，不需要改程式碼，並取得給開發 AI 的串接指令（見 `docs/integration-guide.md` 第 10 節）；所有 App 都登記在資料庫，`config/apps.json` 只剩登入中樞 `account`。Apple App ID 掛到群組主 App ID `phd.starry.app`；App 端以 `openapi/starry-id.v1.json` 產生型別。
2. 使用 Battery 的 App：Owner 在 Admin Lite 開通 Battery 取得金鑰（不給 AI），每個任務的扣量由 App 自己決定，Claude 把該 App 後端的服務金鑰加入 `BATTERY_SERVICE_KEYS`。
3. 使用 RevenueCat 的 App：業主依 `docs/owner-setup.md` 第 6 步設定 Webhook 與 API Key；設定後每日對帳自動涵蓋。
3a. 量子電池（內購加量包）：Battery 全部免費；指定 App 可內購「量子電池」，只能在購買的 App 使用、不過期。Owner 在 `/admin/apps/<id>/quantum` 設定商店商品代碼對應顆數；扣款先免費後量子；RevenueCat 一次性商品入帳、客服退款扣回；帳號合併時移到保留帳號。商店規則：Google Play 虛擬貨幣僅限購買的 App 使用；Apple 3.1.1 購買的點數不得過期並需有還原機制。
3b. 後台首頁（`/admin`）顯示近 24 小時各 App 活躍會員與 Battery 用量、排程心跳與刪除清除重試佇列；`sdk/starry-sdk.ts` 是 App 後端用的單檔 SDK。
3c0. Passkey（WebAuthn）：僅網頁會員中心（`/account/passkey/*`）。會員先用 Apple／Google 登入，再新增 Passkey，之後可直接用 Passkey 登入；只支援 ES256、attestation none、必須使用者驗證（UV）；挑戰值沿用單次 nonce；每人最多 10 把；手機 App 端尚未支援（需要 Associated Domains／assetlinks）。
3c1. 後台批次操作（會員清單勾選 → 調整 Battery／停權／強制登出，一次最多 50 位）；遠端設定表單（`/admin/apps/<id>/config`，覆寫 App 的 config 與 min_version，約 30 秒生效）；RevenueCat 金鑰可在 `/admin/apps/<id>/revenuecat` 管理（加密保存）。
3c2. App 管理員：Owner 在會員頁指派某會員管理指定 App（`app_staff`），僅能編輯該 App 的遠端設定並檢視量子電池商品；不能看會員資料或 RevenueCat 金鑰。
3c4. 程式結構：`src/web/admin.ts`、`account.ts` 只是入口，路由分散在 `admin-*.ts`、`account-*.ts`；路由註冊順序即入口檔的 import 順序，不可隨意調換。
3c5. 各 App 使用概況：`member_apps.last_seen_at`（登入與換發 Token 時更新，每小時最多寫一次）；後台首頁顯示用過／7 天內／30 天內人數與有效權益數；網頁刪帳頁若有生效中的商店訂閱會提醒先取消。
3c6. 客服回覆範本（`REPLY_TEMPLATES`，選了填入可再修改）；App 階段標記 dev/test/live（`app_stages`，只是給人看的標籤，不影響行為）。
3c7. 高風險操作二次確認：有 Passkey 的員工執行刪會員、調整 Battery/量子電池、批次操作、改角色、重產 Battery 金鑰前，必須先用 Passkey 確認（`requireStepUp`，5 分鐘內有效，`staff_stepups`）；沒有 Passkey 的員工不受限（避免鎖死）。
3c8. 串接指令有版本號（`HANDOFF_VERSION`、`HANDOFF_UPDATED`，顯示在後台串接指令頁，也寫在指令第一行；AI 回報時要附上）。改動 `src/apps/handoff.ts` 的文字就必須更新版本與日期時間，否則單元測試會失敗。
3c9. 補發權益：客服（Admin 以上，需 Passkey 二次確認）可在會員頁替會員補發 App 權益（名稱、選填到期日、必填原因）。存在 `entitlement_grants`（不會被 RevenueCat 事件或每日對帳覆蓋），`activeEntitlements` 會合併顯示（`store` 為 `STARRY_GRANT`；同名權益取較長者）；刪除會員一併清除；有補發權益的重複帳號不可自動合併。每個會員最多 10 筆有效補發。營收頁 `/admin/revenue`（Admin 以上）讀 `rc_events`，正式與測試購買分開。
3c10. App 端 Passkey（2026-11-07）：`/v1/auth/passkey(/options)`、`/v1/me/passkeys(/options)`（`src/auth/passkey-api.ts`）。RP ID＝請求網址主機名稱（id.starry.phd）；挑戰是綁定 App 的單次 nonce；接受的來源＝Starry ID 本身（iOS）＋該 App 的 `web_origins`（相關來源）＋由 `android_cert_sha256` 推出的 `android:apk-key-hash:…`（`src/apps/passkey-origins.ts`）。`/.well-known/apple-app-site-association`、`assetlinks.json`、`webauthn` 由 App 登記資料自動產生（`src/apps/well-known.ts`）；業主在後台填 Apple Team ID 與 Android 憑證指紋。串接指令與整合指南第 13 節要求每款 App 的登入頁（iOS／Android／網頁）都提供 Passkey；改串接指令文字要照 3c8 升版本。
3c11. 公告、通知開關與用量暴增保護（2026-11-07）：`scoped_notices`（`src/lib/scoped-notices.ts`）可指定 App 與時段（台灣時間輸入），所有 App 的公告顯示在會員中心，各 App 在 `GET /v1/apps/{appId}/config` 的 `notices` 收到；Owner 在 /admin/notices 管理。`app_surge_limits`（`src/apps/surge.ts`）：Owner 設每 App 每小時 Battery 預留上限，分鐘排程 `surge-guard` 超過就自動把該 App 設為暫停（`app_status_overrides`，稽核 `system.surge_pause`）並寄警示信給客服信箱與 Owner／Admin；恢復由人決定，恢復後只計算觸發之後的用量。會員在 /account/notifications 開關各 App 的通知類別（沿用 `push_preferences`，只能改已存在的項目）。此項取代先前「上限只是軟上限、不自動暫停」的決定（業主 2026-11-07 同意）。
3c3. 邀請碼：Owner 在 `/admin/apps/<id>/invites` 建立，會員在帳號中心輸入後獲得該 App 的免費量子電池（`invite_codes`／`invite_redemptions`）；每人每組碼限一次、有次數與到期日上限；贈送不是購買，不影響每月免費 Battery。
3c. 簽章金鑰輪替：Secret `ACCESS_TOKEN_PREVIOUS_JWKS` 放舊公鑰，輪替期間舊 Token 仍有效，步驟見 `docs/owner-setup.md`。
3c12. 背景佇列與 Service Binding（2026-11-07，ADR 0009）：刪帳清除失敗時，D1 的 `cleanup_jobs` 仍是唯一的真實記錄；另外送一則 `CLEANUP_QUEUE`（`starry-cleanup`，失敗進 `starry-cleanup-dlq`）讓重試更快，每分鐘排程照舊當備援，沒有佇列綁定也能運作。佇列由 Deploy workflow 的「Ensure queues」步驟建立（需要 API Token 有 Queues 編輯權限）。Service Binding 是給同帳號 App 後端的選用路徑，見整合指南第 14 節；Starry ID 本身不需改動。
3c13. 商品目錄（2026-11-07）：`app_products`（`src/apps/catalog.ts`、`/admin/apps/<id>/products`，Owner 編輯、App 管理員可看）登記每款 App 的 iOS／Android 商品 ID 與權益名稱，內容自動寫進串接指令（無商品時串接指令會要求 AI 不要自己決定商品）；只是登記，不改變購買入帳行為，量子電池的「商品代碼 → 顆數」仍在量子電池設定頁。串接指令版本 2026-11-07.6。
3c14. 客服強化（2026-11-07）：`/support?app_id=&app_version=&device=` 由 App 開啟，版本（40 字）與裝置（80 字）只保留英數與常見標點後存入 `support_tickets`；後台客服單列表可依 App 篩選（`?app=<app_id>` 或 `-` 代表未指定），詳情頁顯示版本、裝置與會員編號。後台首頁最上方有四盞紅綠燈（排程、刪除清除、客服單、App 狀態，`src/web/traffic-lights.ts`）；App 卡片顯示近 30 天營收（Admin 以上才看得到）。串接指令版本 2026-11-07.7。
3c15. 帳號中心（2026-11-07）：新增「已登入的 App」（原每款 App 一顆「登出這款 App」，2026-11-07 起改為唯讀清單，見 3c29，`POST /account/apps/:app/logout`，只結束該會員在該 App 所有裝置的登入，不動網頁登入，寫稽核 `account.app_sessions_revoked`，`revokeAppSessions`）與「我的訂閱與購買」（`memberSubscriptions`，跨 App 列出生效中的商店訂閱與客服補發，排除過期、已撤銷與 SANDBOX）。
3c16. App 客服（2026-11-07）：`app_staff.kind` 分 `manager`（App 管理員，只改遠端設定，舊行為不變）與 `support`（App 客服）。Owner 在會員頁「App 管理員與客服」指派；同一會員在同一 App 只有一種身分。App 客服只能在 `/admin/tickets`、`/admin/members` 看自己 App 的客服單與用過該 App 的會員（唯讀＋回覆、結案），範圍外的客服單與會員一律回 404；會員頁是精簡版（只顯示該 App 的使用、權益與客服單，沒有 Battery、裝置、角色、稽核與任何操作）。權限實作：`supportAccess`（`src/web/admin-lib.ts`）只用在客服單與會員的 GET／客服單處理路由，回傳的 `StaffActor.appScope` 標示範圍；其他所有後台路由仍用 `staff()`，不接受 App 客服，所以新增路由預設對他們關閉。新增客服單相關路由時必須用 `scopeAllows` 檢查 `app_id`。
3c17. App 卡片總覽（2026-11-07）：`/admin/apps` 每款 App 一張卡片，集中顯示狀態（預設／目前／原因）、階段、會員數與近 24 小時／7 天／30 天活躍、有效權益、本月與近 24 小時 Battery 用量、每小時暴增上限、實際最低版本（遠端設定覆寫優先，標註來源）、未結客服單（連到依 App 篩選的客服單）、近 30 天營收（Admin 以上）、一鍵暫停／恢復，以及遠端設定、商品目錄、量子電池、邀請碼、串接指令的捷徑（Admin 以上）。數字由 `src/apps/overview.ts` 每個資料庫一次查詢彙整，不是每款 App 各查一次。
3c18. 批次推播（2026-11-07）：會員清單勾選後選「發送推播通知」（Admin 以上，沿用批次操作的 Passkey 二次確認與一次最多 50 位），選 App、填標題（≤100 字）與內容（≤300 字，不可放個資）。`src/notify/bulk.ts` 逐位呼叫 `sendPush`：只送到會員在該 App 的裝置、類別固定為 `announcements`、已關閉的會員與非正常狀態的會員略過，單一會員失敗不影響其他人；結果列出送達、略過與失敗人數。稽核 `admin.bulk_notify`（只記 App，不存文字內容）。可選 Secret `EXPO_PUSH_ACCESS_TOKEN`（Expo 開啟增強推播安全時才需要）。注意：會員在 /account/notifications 只能開關「已存在」的類別，所以 App 要先用 `PUT /v1/me/push-preferences` 登記 `announcements`，會員才有地方關閉。
3c19. 測試 App 資料一鍵清除（2026-11-07）：Owner 在 App 卡片點「清除測試資料」（`/admin/apps/<id>/reset`，`src/apps/reset.ts`），先看各類資料筆數預覽，輸入 App 代碼並通過 Passkey 二次確認後執行。只清該 App 的登入狀態、使用紀錄、推播裝置與偏好、權益與補發、RevenueCat 事件、量子電池餘額與流水、邀請碼兌換紀錄（邀請碼保留、已用次數歸零）。不動會員帳號、稽核紀錄、App 登記與設定、客服單、全站共用的免費 Battery。拒絕條件（執行時重新檢查）：階段是「已上架」；這款 App 曾有任何非沙盒（或環境不明）的權益或 RevenueCat 事件；有進行中的 Battery 任務。稽核 `admin.app_data_reset`（security 保留）。這屬於「刪除正式資料」類操作，只有業主能對測試階段的 App 使用，不要放寬條件。
3c20. App 前端共用套件（2026-11-07）：`sdk/starry-client.ts`（單檔、零相依、手機與網頁共用，`StarryClient`）包好登入中繼（手機 `signInWithRelay`、網頁 `beginRelayRedirect`／`completeRelayRedirect`）、Passkey、Token 儲存與換發（並發只換發一次、401 重試一次、被拒絕或重用就登出）、啟動檢查與公告（`checkApp`）、帳號呼叫。平台差異（儲存、SHA-256、開啟登入視窗、Passkey）用轉接器注入；不含任何金鑰。`tsconfig.sdk.json` 讓 `npm run typecheck` 一併檢查；行為測試在 `test/unit/starry-client.test.ts`。改動 API 契約時要同步修改這個檔案與整合指南附錄；串接指令（版本 2026-11-07.8）已要求 App 前端使用它。
3c21. （已被 3c24 取代）內建 App 後台覆寫機制已移除，見 3c24 與 ADR 0011。
3c22. 全 App 推播佇列（2026-11-07，ADR 0009 擴充）：Admin 以上在 `/admin/broadcast` 對某款 App 的所有「有登記推播裝置的正常會員」發送公告推播（標題 ≤100 字、內容 ≤300 字，不可放個資），需勾選確認與 Passkey 二次確認。`src/notify/broadcast.ts`：每 50 位會員一則佇列訊息（`NOTIFY_QUEUE`，`starry-notify`，失敗進 `starry-notify-dlq`），文字存在 `notify_broadcasts`（identity 0027）不放進訊息；消費者逐批呼叫 `bulkPush`，把送達／略過／失敗人數累加回該列，全部批次完成才寫 `finished_at`；`notify_broadcast_chunks` 讓重複投遞的訊息不會重送。一次最多 20000 位；沒有佇列綁定時頁面直接說無法發送（不會退回同步送出）；送進佇列失敗會移除紀錄、沒有發出任何通知。稽核 `admin.broadcast_notify`（只記 App）。極少數情況（消費者在送出後、記錄前中斷）同一批可能重送一次。少數幾位仍用會員清單的批次推播。佇列由 Deploy workflow 的「Ensure queues」建立；清除佇列與推播佇列共用同一個 `queue()` 入口，以佇列名稱（`starry-notify*`）分流。
3c23. 中央 Apple Team ID 與整合狀態（2026-11-07，PR A）：全生態系的 Team ID 是公開值，放 wrangler.jsonc 的 Worker 變數 `STARRY_APPLE_TEAM_ID`（正式與 staging 同值 4W7QRTXN5Y；注意與 Sign in with Apple 撤銷用的 Secret `APPLE_TEAM_ID` 是兩個不同名稱，不可互相覆蓋）。`src/apps/team-id.ts`：`effectiveTeamId(app, env)` = App 自己存的值（舊登記）優先，否則中央值；無效值視為未設定。`/.well-known/apple-app-site-association` 與串接指令都用它。新增／編輯 App 表單不再有 Team ID 欄位（新登記一律存 null＝跟隨中央），Android SHA-256 指紋移到表單主區塊、選填、貼上格式寬鬆（大小寫、有無冒號、`SHA256:` 前綴都接受，`normalizeFingerprint`），格式錯誤給中文提示。`/admin/apps/status`（`src/web/admin-status.ts`，`src/apps/integration-status.ts`）：每款 App 的整合清單（iOS／Android Passkey、網頁來源、Battery 金鑰、商品目錄、RevenueCat），待處理項目也顯示在 App 卡片；Android 沒有指紋就明確顯示「Android 正式簽章尚未設定，原生 Passkey 關聯尚待完成。」，不假裝已可用。`refreshDynamicApps`：某一列登記資料驗證失敗時沿用上一次正常的定義（App 不會消失），並在 App 清單與整合狀態頁顯示警示（`invalidRegisteredApps`）。串接指令版本 2026-11-07.9。
3c24. 所有 App 都登記在資料庫（2026-11-07，PR B，ADR 0011）：migration identity 0028 把 `echo`、`recordnote` 的定義寫入 `registered_apps`（INSERT OR IGNORE，不覆蓋既有列；Team ID 不存，跟隨中央），並刪除 `builtin_app_overrides`。`config/apps.json` 只剩登入中樞 `account`（它就是登入中樞本身，固定在檔案，後台不可改）。所有 App 用同一個流程：新增 App → 編輯登記資料（儲存需要 Passkey 二次確認，`requireStepUp`）→ 整合狀態總覽 → 串接指令。`refreshDynamicApps` 在冷啟動時讓所有請求等第一次讀取（`loaded`／`inflight`），之後才是 30 秒快取；讀取失敗 10 秒內不重試。資料庫整個讀不到時這兩款 App 會暫時無法辨識（業主接受：資料庫是 sessions 的來源，本來就無法登入）；單列壞掉時沿用上一次正常的定義（3c23）。單元測試的預載 `test/support/shipped-apps.ts`（`npm run test:unit` 以 `--import` 載入）提供這兩款 App 的夾具，`test/unit/shipped-apps.test.ts` 確保夾具與 migration 的資料一致；改動這兩款 App 的預設值要同時改 migration 之後的新 migration 與夾具。
3c25. 後台改版（2026-11-07）：Admin 頁面改為滿版流體寬度（`body.admin`，不再鎖 720px；會員帳號中心仍是窄欄），頂部固定列放常用頁（首頁、會員、客服單、App、電池艙），其餘收進「更多」（公告與維護、全 App 推播、整合狀態、營收、稽核紀錄、新增 App）；手機寬度（≤900px）全部收進漢堡選單。選單是純 CSS（隱藏 checkbox＋`<details>`），不需要 inline script，符合現有 CSP。選單項目定義在 `src/web/admin-lib.ts` 的 `FULL_MENU`／`SCOPED_MENU`（App 客服只看客服單與會員）；新增後台頁面時要決定放常用或「更多」。首頁改為統計卡在上、明細收合；App 卡片改格狀，常用按鈕在前，遠端設定、商品目錄、量子電池、邀請碼、階段與狀態表單收進「更多設定與操作」。順手修正：`button.danger` 文字色（原本紅字疊紅底看不到）、一鍵暫停表單原本巢狀在卡片表單內而失效（表單不能巢狀，現在是卡片的兄弟元素，按鈕以 `form=` 屬性對應）。
3c26. 序號產生器（2026-11-07，battery 0009）：一套產生器通用所有 App，沿用 `invite_codes`（新增 `kind`：`battery`＝全 App 共用的免費電池，只加「本月」額度，下個月恢復標準額度；`quantum`＝指定一款 App 的免費量子電池，只存進該 App；以及 `batch_id`）。Owner 在 `/admin/battery/codes`（電池艙頁面最上方的大卡片）一次產生 1～100 組、每組 1～1000 顆、可設每組可兌換人數與到期日，產生需要 Passkey 二次確認，稽核 `admin.redeem_codes_created`（不記序號本身）；每組附兌換網址 `https://id.starry.phd/account/redeem/<序號>`，可複製全部、查看已產生的批次、整批停用或重新啟用。會員在帳號中心輸入序號，或點網址：未登入先登入（`safeNext` 只接受路徑，所以序號放在路徑裡），頁面顯示可領取的內容，按「兌換」才入帳（開啟連結不會兌換，避免連結預覽誤用掉）。電池序號入帳失敗會退回已兌換標記（`redeemInvite` 的 undo）。商店規則（Apple 3.1.1、Google Play 付款政策）：序號只能免費發送，不可販售；兌換只在網頁，App 內不放序號輸入畫面或兌換連結（串接指令版本 2026-11-07.10 已寫明）。後台選單的「Battery」更名為「電池艙」。每 App 的邀請碼頁 `/admin/apps/<id>/invites` 保留，與產生器共用資料表。
3c27. 通用量子電池序號（2026-11-07，battery 0010）：量子電池序號可以不指定 App（`app_id` 為 NULL＝通用）：兌換的人在兌換頁自己選一款 App，入帳後固定在那一款（仍然不能跨 App 使用），同一人同一組序號只能兌換一次，不能換到別款 App 再領。網址頁 `/account/redeem/<序號>` 會出現 App 下拉選單；在帳號中心直接輸入通用序號時，沒選 App 會導到該頁（`redeemInvite` 回 `need_app`，這時不會扣次數）。產生器的 App 欄位留空＝通用；指定 App＝只能兌換到那一款。電池序號仍然不綁 App。商店規則不變（免費發送、不可販售、只在網頁兌換）。注意：App 的「清除測試資料」只清該 App 代碼綁定的序號兌換紀錄，通用序號的兌換紀錄不在其中。
3d. 刻意保留的設計（不是漏做）：`account`（登入中樞）固定在 `config/apps.json`，不依賴資料庫登記；刪除帳號一律立即永久刪除（2026-11-07 起沒有 7 天寬限期，舊的待刪除程式已移除）。為了舊版 App 相容，`deletion_requested_at`／`deletion_purge_at` 欄位仍存在但永遠是 null，`DELETE /v1/me/deletion` 永遠回 409；Email 登入依業主決定不做。
4. 業主外部事項：`docs/owner-setup.md`（Google Play 帳號類型、App Store 付費協議、GitHub 帳號整併等）。

### 3c28 新增 Passkey 不再要求近期登入（2026-11-07）
- `POST /v1/me/passkeys/options`、`POST /v1/me/passkeys` 與網頁帳號中心的新增 Passkey，不再檢查 10 分鐘內登入，不再回 `REAUTH_REQUIRED`。
- 每位會員上限 10 把仍有效；加綁 Apple／Google 與合併帳號仍需近期登入（`isRecentLogin` 保留）。
- 串接指令版本 `2026-11-07.11`。

### 3c29 共用登入（Device SSO，2026-11-07）
- migration 0029：`device_sso`（sso_id、user_id、token_hash、session_version、expires_at、revoked_at），`sessions.sso_id`。
- `src/auth/sso.ts`：`POST /v1/auth/sso/start|exchange|status|logout`。start 需 Bearer；換會員時以 `previous_sso_token` 結束舊會員的 sso 與其所有 App 登入；同會員則沿用其他 App 登入。exchange 為該 App 建立一般 session（帶 sso_id）。logout 撤銷 sso 及所有該 sso 的 sessions。`logout-all`（session_version 遞增）使 sso 失效。
- SDK：`StarryClientOptions.sharedStorage`、`syncDeviceSignIn()`；`signOut()` 會呼叫 sso/logout（登出所有 App）。無 `sharedStorage` 時行為不變。
- 網頁帳號中心已移除「登出這款 App」按鈕（共用登入下無意義）；`/account/apps/:app/logout` 路由保留。
- 串接指令版本 `2026-11-07.12`。

### 3c30 網頁版共用登入（2026-11-07）
- `src/web/sso-relay.ts`：`GET /auth/sso/adopt|check|logout`（頂層導向；回傳網址限該 App 登記的網頁版來源）。cookie `__Host-starry_sso`（HttpOnly、Secure、Lax、30 天）存裝置共用 token。check 回傳 `#sso_code=&sso_user=&state=` 或 `#sso_none=1`。
- `src/auth/sso.ts`：`POST /v1/auth/sso/web-code`（把 sso token 密封 2 分鐘供 adopt 使用）、`POST /v1/auth/sso/web-exchange`（code 綁定 App 與 nonce 雜湊，nonce 單次使用）。共用 `signInFromSso`。
- SDK：`shareWebSignIn`、`syncWebSignIn`、`completeWebSsoCheck`、`signOutWebEverywhere`。限制：只在同一瀏覽器的網頁版之間連動，下一次載入頁面才同步。
- 串接指令版本 `2026-11-07.13`。
