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

1. App 接入：新 App 由 Owner 在 Admin Lite（`/admin/apps/new`）登記，不需要改程式碼，並取得給開發 AI 的串接指令（見 `docs/integration-guide.md` 第 10 節）；既有 App 仍在 `config/apps.json`。Apple App ID 掛到群組主 App ID `phd.starry.app`；App 端以 `openapi/starry-id.v1.json` 產生型別。
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
3c3. 邀請碼：Owner 在 `/admin/apps/<id>/invites` 建立，會員在帳號中心輸入後獲得該 App 的免費量子電池（`invite_codes`／`invite_redemptions`）；每人每組碼限一次、有次數與到期日上限；贈送不是購買，不影響每月免費 Battery。
3c. 簽章金鑰輪替：Secret `ACCESS_TOKEN_PREVIOUS_JWKS` 放舊公鑰，輪替期間舊 Token 仍有效，步驟見 `docs/owner-setup.md`。
3d. 刻意保留的設計（不是漏做）：echo／recordnote／account 留在 `config/apps.json`（資料庫故障時既有 App 仍可登入）；7 天刪除寬限期仍是現行對外行為（`deletion_purge_at` 欄位）；Email 登入依業主決定不做。
4. 業主外部事項：`docs/owner-setup.md`（Google Play 帳號類型、App Store 付費協議、GitHub 帳號整併等）。
