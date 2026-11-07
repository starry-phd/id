# 業主設定清單

依序完成即可讓 Starry ID 上線。每一步都能用手機完成。完成一步後在交接 Issue 留言，Claude 會接手後續。

## 1. 建立 GitHub Repo（一次）

1. 在 GitHub 組織 `starry-phd` 建立空白 Repo `id`（Public，不要勾選 README、.gitignore、License）。
2. 告訴 Claude「Repo 建好了」。Claude 會推送全部程式、開交接 Issue，並設定 main 的分支保護（必要檢查：Repository policy、Required validation）。

## 2. Cloudflare API Token（一次）

1. Cloudflare（starry.phd@gmail.com 帳號）→ 右上角頭像 → My Profile → API Tokens → Create Token → 使用範本「Edit Cloudflare Workers」。
2. 權限另外加入：Account｜D1｜Edit、Account｜Workers R2 Storage｜Edit、Zone｜DNS｜Edit（建立 id.starry.phd 自訂網域用）。Account Resources 只選 starry.phd 帳號；Zone Resources 只選 `starry.phd`。
3. 到 GitHub Repo → Settings → Secrets and variables → Actions → New repository secret：
   - `CLOUDFLARE_API_TOKEN`：剛建立的 Token
   - `CLOUDFLARE_ACCOUNT_ID`：starry.phd 帳號的 Account ID（Cloudflare 首頁 → 任一網域 Overview 右側 API 區塊，或 Workers & Pages 右側）
4. 不必等下一次合併：到 GitHub Repo → Actions → Deploy → Run workflow（分支選 main）即可立即部署 staging 與 production，流程會自動產生簽章金鑰與加密金鑰。之後每次合併到 main 都會自動部署。
5. 部署完成後打開 https://id.starry.phd/v1/health，看到 `"status":"ok"` 即成功。

## 3. 設定自己為 Owner（一次）

1. Cloudflare → Workers & Pages → `starry-id` → Settings → Variables and Secrets → Add → 類型 Secret，名稱 `OWNER_CLAIM_CODE`，值自訂一組 12 字以上的密語。
2. 用手機開 https://id.starry.phd/account 登入（網頁登入需先完成第 4 步的 Google Web Client）。
3. 開 https://id.starry.phd/account/claim-owner，輸入密語。
4. ~~回到 Cloudflare 刪除 `OWNER_CLAIM_CODE`~~：改由 Claude 執行 GitHub Actions →「Ops」→ `remove-owner-claim-code` 刪除。

## 4. 登入用的 Client ID（上架前）

提供給 Claude，由 Claude 登記到 Admin Lite（不是秘密；要在後台自己填也可以）：

| 項目 | 在哪裡 | 用途 |
|---|---|---|
| Echo iOS Bundle ID | App Store Connect／Expo 設定 | Apple 原生登入的 audience |
| Apple Services ID（例如 `phd.starry.id.web`） | Apple Developer → Identifiers → Services IDs，啟用 Sign in with Apple，網域 `id.starry.phd`，Return URL `https://id.starry.phd/account` | 網頁與 Android 的 Apple 登入 |
| Google OAuth Client ID：iOS、Android、Web | Google Cloud Console → APIs & Services → Credentials | Google 登入；Web Client 的 Authorized JavaScript origins 加入 `https://id.starry.phd` |

所有 Starry App 必須在同一個 Apple Developer Team，並在 Sign in with Apple 設定 App 群組（規格 G-02）。

## 5. Sign in with Apple 金鑰（上架前，Apple 規定刪帳時撤銷 Token）

Apple Developer → Keys → 建立啟用 Sign in with Apple 的 Key，下載 .p8。在 Cloudflare `starry-id`（staging 為 `starry-id-staging`）加入 Secrets：

- `APPLE_TEAM_ID`：10 碼 Team ID（Secret，Sign in with Apple 撤銷 Token 用；與 Passkey 用的公開變數 `STARRY_APPLE_TEAM_ID`（寫在 wrangler.jsonc）是同一個值，但名稱不同，兩者都要有）
- `APPLE_KEY_ID`：Key ID
- `APPLE_PRIVATE_KEY`：.p8 檔完整內容（含 BEGIN／END 行）

## 6. RevenueCat（Echo 開始販售時）

每款 App 一個 RevenueCat 專案（規格 S-BIL-01），App User ID 使用 Starry 會員 ID。

1. RevenueCat → Project → Integrations → Webhooks：URL `https://id.starry.phd/v1/billing/revenuecat/echo`，Authorization header 填一組自訂的長字串。
2. RevenueCat → Project settings → API keys → 建立 Secret API key（v1）。
3. Cloudflare `starry-id` Secrets（JSON，每款 App 一筆）：
   - `REVENUECAT_WEBHOOK_AUTH`：`{"echo":"上一步自訂的長字串"}`
   - `REVENUECAT_API_KEYS`：`{"echo":"sk_..."}`

## 7. 系統 Email（S-NTF-02，業主 2026-11-03 核准 Workers Paid）

1. 升級 Workers Paid（每月 5 美元，含每月 3,000 封信）：Cloudflare → Workers 和 Pages → 方案 → Workers Paid。
2. 客服信箱：運算 → Email Service → Email Routing → 網域 `starry.phd` → 自訂地址 `support` 轉寄到業主 Gmail → 新增記錄並啟用；到 Gmail 點驗證信。
3. 寄信網域：Email Service → Email Sending → Onboard Domain → `starry.phd` → Done（自動加入 `cf-bounce` 的 MX／SPF／DKIM 與 `_dmarc` 記錄）。
4. Apple 隱藏信箱：Apple Developer → Services → Sign in with Apple for Email Communication → Configure → 加入網域 `starry.phd` 與寄件人 `support@starry.phd`（與客服信箱共用）。
5. 告訴 Claude 完成；Claude 在 `wrangler.jsonc` 加入 `send_email` 綁定 `EMAIL` 並部署，寄一封測試信確認。

已於 2026-11-03 全部完成並實測。寄出的信：刪帳申請確認（寄給會員）、Admin Lite 回覆客服單（寄給提問者）、新客服單通知（寄到 support@starry.phd）、客服人員調整會員 Battery 的通知（只寫項目、不寫數字）。不寄行銷信。

## 8. 其他

- 法律文件：業主 2026-11-03 授權 Claude 定稿，正式版本 `2026-11-03`（經營者 CHIEN-LUNG TU，管轄法院臺灣臺北地方法院）。業主可隨時審閱 https://id.starry.phd/privacy 與 /terms；修改內容會更新版本並請所有會員重新同意。
- Turnstile（客服表單防濫用）：已完成。業主 2026-11-03 執行 GitHub Actions →「Ops」→ `setup-turnstile` 建立 Widget「Starry ID support form」（網域 id.starry.phd 與 staging），Secret 已設定，公開 Site Key 寫在 `wrangler.jsonc`。
- `OWNER_CLAIM_CODE`：已確認正式與 staging 都不存在（Ops `remove-owner-claim-code`，2026-11-03）。
- 規格「需要業主處理的外部事項」：Google Play 帳號類型（G-03）、App Store 付費協議（G-02）、GitHub 帳號整併（G-01）。

## 9. Starry Battery

不需要業主設定。Owner 可在 Admin Lite →「Battery」調整每位會員的每月額度（預設 10 顆，業主 2026-11-03 指定）與各 AI 任務的消耗；App 後端的服務金鑰由 Claude 在該 App 開始使用 AI 時設定。

## 10. 已完成：main 分支保護

GitHub Ruleset「Protect main」（Active、Bypass 清單為空）：必須經 PR 合併（只允許 Squash）、必須通過 Repository policy 與 Required validation、線性歷史、禁止強制推送與刪除。緊急時到 Settings → Rules → Rulesets 暫時改為 Disabled，處理完改回 Active。

## 11. 繁星回聲接入 Starry ID（2026-11-03，已改用 Starry 登入中繼）

以下都可用手機完成，做完任何一段都可以先告訴 Claude。App 網頁版與 Android 的登入都經過 `id.starry.phd`，所以 Apple 與 Google 的網頁設定只要做這一次；以後新增 App 網頁版或換網域，只要 Claude 改設定檔，不必再進後台。

### A. Google（console.cloud.google.com → 左上選單 →「API 和服務」→「憑證」）

1. 點「Starry ID Web」（網頁應用程式用戶端）→「已授權的重新導向 URI」→「新增 URI」，加入兩個：
   - `https://id.starry.phd/auth/google/callback`

   → 儲存。不必加入繁星回聲網頁版（`echo.starry.phd`）的網址，也不必加 workers.dev。
2. 「建立憑證」→「OAuth 用戶端 ID」→ 類型「iOS」→ 名稱「繁星回聲 iOS」→ 軟體包 ID `phd.starry.echo` → 建立。把「用戶端 ID」傳給 Claude。
3. 「建立憑證」→「OAuth 用戶端 ID」→ 類型「Android」→ 名稱「繁星回聲 Android（上傳金鑰）」→ 套件名稱 `phd.starry.echo` → SHA-1 填繁星回聲的 AI 給你的值 → 建立。Google Play 應用程式簽署金鑰的 SHA-1 再建一個「繁星回聲 Android（Play 簽署）」。Android 的用戶端 ID 不用給 Claude。

### B. Apple（developer.apple.com → Certificates, Identifiers & Profiles → Identifiers）

1. 點 `phd.starry.echo`（若還沒有，請繁星回聲的 AI 先以 EAS 建立）→ 勾選「Sign in with Apple」→ 右邊「Edit」→ 選「Group with an existing primary App ID」→ 選 `phd.starry.app` → Save → Continue → Save。這讓同一個人在繁星回聲與帳號中心是同一個 Apple 身分。
2. 右上角篩選改成「Services IDs」→ 點 `phd.starry.id.web` → Sign in with Apple 右邊「Configure」：
   - Domains and Subdomains：只留 `id.starry.phd`（不必加 `echo.starry.phd`、不必加 workers.dev）
   - Return URLs 加入：`https://id.starry.phd/auth/apple/callback`（原有的 `https://id.starry.phd/account` 保留）
   - Next → Done → Continue → Save。

## 12. Sentry 錯誤監控（選用，免費方案）

程式已完成，設定 DSN 後才會送出錯誤（只送錯誤類型、訊息、程式位置與請求編號，不含會員資料或 Token）。建立新帳號依規格需業主自行決定。

1. 手機開 sentry.io → Get Started，用 starry.phd@gmail.com 註冊（選免費的 Developer 方案）。
2. 建立專案：平台選「Cloudflare Workers」（找不到就選「Node.js」），專案名稱 `starry-id`。
3. 畫面上會出現 DSN（`https://…@….ingest.sentry.io/…`），複製傳給 Claude。DSN 是公開金鑰，可以直接貼在對話裡。
4. Claude 把它寫進 `wrangler.jsonc` 的 `SENTRY_DSN` 並部署；之後伺服器錯誤與排程失敗會寄到你的 Sentry 信箱。


## 簽章金鑰輪替（約每年一次，或懷疑外洩時）

1. 產生一把新的 ES256 金鑰（kid 取新名字，例如 `2027-1`），把私密 JWK 存成 Worker Secret `ACCESS_TOKEN_PRIVATE_JWK`（金鑰不要給 AI、不要貼到對話）。
2. 同時把**舊金鑰的公開部分**（kty、crv、x、y、kid，不含 d）放成 JSON 陣列，存到 Worker Secret `ACCESS_TOKEN_PREVIOUS_JWKS`。這樣已發出的 Access Token（最長 15 分鐘）仍然有效，使用者不會被登出，`/.well-known/jwks.json` 也會同時公布新舊公鑰。
3. 等 1 小時後，刪除 `ACCESS_TOKEN_PREVIOUS_JWKS`。若懷疑舊金鑰外洩，第 2 步就不要設定，所有人需重新取得 Token（Refresh 仍可使用）。
