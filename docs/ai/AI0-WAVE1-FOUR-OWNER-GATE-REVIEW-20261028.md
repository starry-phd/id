# AI-0｜Wave1 Round-001 四組程式整合審閱／Gate 1–3｜2026-10-28

狀態：**AI-0 SOURCE-PRESERVING INTEGRATION DRAFT**。已核對 AI-1 #189、AI-2 #188、AI-3 #187、AI-4 #190 每一份固定 PR 最終 SHA 及 12 個 Git blob；整合時使用原始 blob SHA，不手工轉錄、不改四組的唯一 Writer，不合併 main。四組各自 GitHub Actions 同版離線 CI 已由各組回報成功；**本整合 Commit 的 CI 必須另外驗證**。Release G00～G10 繼續 11/11 BLOCKED、P05/PUBLISHABLE=false。

## A. GitHub 原件及實際檔案／邊界
| Owner | Source Draft PR | 最終 owner SHA | 新增內容 | 判定 |
| --- | --- | --- | --- | --- |
| AI-1 / Auth | [#189](https://github.com/starry-phd/id/pull/189) | `bb4e98e4132900ecdc32f61037d2cb9bad8e8723` | 真實簽名 Session + D1 read-only 進入購買前身分 Gate / 9 離線測試 / ADR | 安全離線候選，無 Live Store 權力 |
| AI-2 / Billing | [#188](https://github.com/starry-phd/id/pull/188) | `65ccc6aba2679eb26e34bb15bb86606c9562fb17` | RevenueCat review-only、兩類 IAP/每 App 權益隔離 / 17 離線測試 / 交接 | 無真實商店收據／發權能力 |
| AI-3 / Battery/H | [#187](https://github.com/starry-phd/id/pull/187) | `d1fdb81cddc36e0e890cd990e15fdeb67d428b8f` | 通知安全／撤權／冪等預檢 / 18 離線測試 / 交接 | 寄送／Queue ACK 永遠 false |
| AI-4 / API/DevOps | [#190](https://github.com/starry-phd/id/pull/190) | `2ab25229f2b9d3a31fb9c0ef0f6a60697f475208` | Worker GET /v1/health 與 OpenAPI 真實路由一致性 / 10 離線測試 / RCA | 不公開新 Auth/Billing/Battery/管理端路由 |

## B. AI-0 Gate 1：契約審閱結果
**通過範圍（只可作離線模型）**：原始 12 blobs 完整、四組 owner path 不重疊、全屬新檔；每份模組關鍵輸出皆不允許 Store、付費發權、Battery 銷售、通知寄送／Queue ACK、Production；D01=D 適用未來新消費 App，不擅升本中央 Expo54；Q1=A/Q2=A/Q3=A/Q4=D/Q5=B 保留。

**尚未通過的跨域介面（需 Round-002）**：
1. AI-1 `PurchaseServerIdentity` 是 server-only 的 `starryUserId/session_id/auth_version` 及 5 秒短期 proof；AI-2 `OfflineIdentity` 只承認 `kind='offline_auth_fixture_only'`、`member_digest`。**目前沒有核准的簽名身分→Billing 身分／member digest 轉接契約**；不可直接拿 UI `isLoggedIn`、自報 member ID、WeakMap snapshot 或測試 fixture 當真正交易授權。由 AI-1 #2 + AI-2 #3 提交交互 DTO/再次查驗方案供 Gate 1 審核。
2. AI-3 的 `verifyCanonicalSource`、`readSessionFence`、`readDedupe`、`lawfulRetentionNow` 及通知同意仍只是安全 Ports；**沒有 AI-0/AI-4 核准的實體 P05 signed issuer、AI-1 權威 Session read、durable receipt／法定保留同時驗證**。不得送、重試或 ACK，需 AI-1/#2、AI-4/#5、AI-3/#4 分工提出正式版本化合約。
3. AI-4 所比對的真正 Worker/OpenAPI **只有 `GET /v1/health`**。它能找出漂移與誤開路由，**不代表 Auth/Billing/Battery 請求路由、Store/RevenueCat、OpenAPI client generator 已實作或可部署**。新增受保護路由待 AI-0 Gate 後由 AI-4 負責。
4. 四組都沒有真正 iOS/Android Store Sandbox／RevenueCat 真 SDK／Cloudflare live staging 整合證據。AI-4 唯讀查明既有 Cloudflare preview 失敗為 `npx wrangler preview` 缺 `previews` 設定；僅提出 RCA，**無授權修復 Cloudflare Trigger／Config 或影響 Production**。

**Gate 1 結論：PARTIAL / BLOCKED（原件和 owner 邊界可接受，跨系正式授權／介面未通過）。**不可把四組模組作為 Live 真權益／通知／會員／商店啟用。

## C. Gate 2：同一整合 SHA 的驗證要求
- 本次 Git Tree 從 AI-0 `506e33d68a2b2a069b5a356c0bf4192df7db7463` 建立新 Draft；導入四組原件 12 路徑，另有本審閱與來源 manifest 及可執行離線安全/原始 blob 一致性測試。
- CI 必須在**整合 SHA**跑 typecheck、lint、Node (含四組新增 tests)、SQLite memory、Expo DEV、Worker dry-run、正式 `--assert-blocked`；所有 run links / 異常與 Cloudflare checks 分列。
- 只有整合 SHA 的 GitHub Actions 通過後，Gate 2 的「離線整合」可標通過；**Cloudflare 外部檢查不因 GitHub offline success 自動通過**。
- 本 Draft **不直接 merge 4 個 PR、絕不 merge main、沒有修改第三方帳號或真正生產資源**。

## D. Gate 3：正式風險／授權
**BLOCKED**：11/11 release gate、P05 中央正規審計、具法律依據的 Q104/Q119 retention、跨 Store 權益與續訂 Sandbox/政策、真正 signed Store receipt、real D1/Cloudflare staging & rollback、正式原生 Build/上架／付費。永久免費 Starry Battery 不可銷售，Ads OFF，H-Global 停止，Q5=B 不建立新私有 consumer Monorepo，Production 與 main 需另行業主授權。

## E. Round-002 交接順序（透過 GitHub）
- **AI-1 → AI-2**：提供服務端可重新查驗的版本化 Starry ID＋appId＋session 狀態綁定契約，保留帳號切換/撤權/過期的 fail-closed；不讓 Billing 接收 UI fixture 作權威。
- **AI-2 → AI-4**：交 per-App Store Product/Entitlement 路徑與 RevenueCat webhook signed authority，先離線接口與拒絕測試，雙平台商店沙盒仍另需核准。
- **AI-3 ↔ AI-1 / AI-4**：P05 signed issuer、SessionFence 事件一致性、durable dedupe/Queue ACK 原子性與資料保留權威，必須先核對已核准業務規範。
- **AI-4 → AI-0**：OpenAPI 受保護路由缺口、CI/Release Gate 與 Cloudflare Preview 配置 RCA／隔離修復提案；只有 Owner 授權才變更 Cloudflare 真服務。
- **AI-0**：每個下一輪 PR 仍須最新 base／新增原件 SHA、同版 CI 與專責 Issue 回報，嚴守 D01～08、Q1～Q5，勿讓舊 D01 pending/PoC 誤導。
