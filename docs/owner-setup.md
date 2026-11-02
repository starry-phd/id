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
4. 回到 Cloudflare 刪除 `OWNER_CLAIM_CODE`。

## 4. 登入用的 Client ID（上架前）

提供給 Claude 寫入 `config/apps.json`（不是秘密）：

| 項目 | 在哪裡 | 用途 |
|---|---|---|
| Echo iOS Bundle ID | App Store Connect／Expo 設定 | Apple 原生登入的 audience |
| Apple Services ID（例如 `phd.starry.id.web`） | Apple Developer → Identifiers → Services IDs，啟用 Sign in with Apple，網域 `id.starry.phd`，Return URL `https://id.starry.phd/account` | 網頁與 Android 的 Apple 登入 |
| Google OAuth Client ID：iOS、Android、Web | Google Cloud Console → APIs & Services → Credentials | Google 登入；Web Client 的 Authorized JavaScript origins 加入 `https://id.starry.phd` |

所有 Starry App 必須在同一個 Apple Developer Team，並在 Sign in with Apple 設定 App 群組（規格 G-02）。

## 5. Sign in with Apple 金鑰（上架前，Apple 規定刪帳時撤銷 Token）

Apple Developer → Keys → 建立啟用 Sign in with Apple 的 Key，下載 .p8。在 Cloudflare `starry-id`（staging 為 `starry-id-staging`）加入 Secrets：

- `APPLE_TEAM_ID`：10 碼 Team ID
- `APPLE_KEY_ID`：Key ID
- `APPLE_PRIVATE_KEY`：.p8 檔完整內容（含 BEGIN／END 行）

## 6. RevenueCat（Echo 開始販售時）

每款 App 一個 RevenueCat 專案（規格 S-BIL-01），App User ID 使用 Starry 會員 ID。

1. RevenueCat → Project → Integrations → Webhooks：URL `https://id.starry.phd/v1/billing/revenuecat/echo`，Authorization header 填一組自訂的長字串。
2. RevenueCat → Project settings → API keys → 建立 Secret API key（v1）。
3. Cloudflare `starry-id` Secrets（JSON，每款 App 一筆）：
   - `REVENUECAT_WEBHOOK_AUTH`：`{"echo":"上一步自訂的長字串"}`
   - `REVENUECAT_API_KEYS`：`{"echo":"sk_..."}`

## 7. 其他

- 法律文件：審閱 https://id.starry.phd/privacy 與 /terms，補上【待業主確認】的經營者名稱、客服信箱與管轄法院。確認後 Claude 會把版本從 `draft-2026-11-03` 改為正式版本。
- 選用：Cloudflare Turnstile 建立 Widget（網域 `id.starry.phd`），把 Site Key 與 Secret Key 給 Claude 設定，用於客服表單防濫用。
- 規格「需要業主處理的外部事項」：Google Play 帳號類型（G-03）、App Store 付費協議（G-02）、GitHub 帳號整併（G-01）。
