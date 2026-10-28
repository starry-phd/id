# AI-1 R23｜G02 OIDC／G03 Auth Session D1 正式驗收缺口：隔離可重現預檢與安全測試計畫

## 依據與既有成果（不重做）
- [新任 AI-0 五組真正同版 PR #171](https://github.com/starry-phd/id/pull/171)，固定 HEAD `2841011b9a32680d889c53062b659b15b1ac63e9`，3/3 GitHub Actions completed/success；原始 AI-1 #167 真 WebCrypto HMAC + SQLite Auth 邊界、#160 AuthClient 與 34 個原始來源 Git Blob 已完好包含。#156／#1／AI-1 #2 最新派工明言下一輪要優先處理真 Gate；已有 Offline PASS 不等於 Live PASS。
- 正式 `docs/release-readiness/release-readiness.v0.json` 的 G02-OIDC/G03-SESSION-D1 各自 `status=blocked`，`verified_by=null`，`approval_record_url=null`，11 Gate 全部 blocked、owner release_authorization=false。
- `apps/api/wrangler.toml` 的 staging 尚未宣告 Auth D1 binding；`apps/api/src/index.ts` 僅 `GET /v1/health` liveness，沒有正式 OAuth、Session 或 protected API 路由。就算原 HMAC/PKCE/CAS source 存在，Repo 內沒有 real Cloudflare D1／Apple/Google authorized flow 的 live Gate 證據。
- Cloudflare #164 自動 Preview Build `239a1aaa-39ff-4e8e-b355-ccfa94edaecc` 因缺 `previews` block FAILED；AI-0 #165 RCA / AI-4 #166 dry-run 與 #171 G08 review 已記錄，不屬 AI-1 修理 Worker 設定的權限。AI-0 選 A：目前既有 id-starry Trigger 保持不動。

## 此輪真正新增的可執行工程
`src/r23-auth-g02-g03-live-preflight.ts`：只讀 Repository 正式 Release Manifest、staging Wrangler TOML、真 Worker API route、Oidc crypto、signed HTTP/Auth D1 Principal、Session CAS 原始 source，回傳機器可讀 `starry.auth.r23.g02-g03.preflight.v1` 固定 12 類正式驗收阻塞與可證實的 code/config 列。無網路、無真金鑰、無任何 D1 adapter、無 OAuth 呼叫、無會員資料。掃描 repo 可判定程式碼存在與 declaration 差距，永不把它升級為 `verified_live` 或釋出權限。

`scripts/r23-auth-preflight.mjs`：Node22 可在 Repo checkout 重現（所有輸入來自確切 Git source）：
- `node modules/starry-id-v1/scripts/r23-auth-preflight.mjs --assert-blocked`：只有正式 11/11 Gate 真正保持 blocked、AI-1 G02/G03 明確 blocked 且 owner 不允許部署才 exit 0；Gate 遭偽造核准／結構錯誤／檔案消失 exit 2。此 0 代表**安全封鎖符合預期**，不是驗收通過。
- `node modules/starry-id-v1/scripts/r23-auth-preflight.mjs --require-live`：一律 exit 3（尚無獲准的獨立實體證據；即使本機造出 D1 binding/受保護路由／填入假 Gate passed 也禁止輸出 live PASS）。參數錯誤 exit 2。
- `test/r23-auth-g02-g03-live-preflight.test.mjs`：讀原始真正檔案與合成惡意配置，驗證新增的憑證／路由證據缺失、假 Manifest 放行／缺 Gate、註解 D1／wrong env、虛構 route、源缺失、無 secret、CLI exit-code；沒有建立/修改正式 D1、Cloudflare 或 Store。

## 下一輪需另外授權的分階段真實 G02/G03 隔離測試（AI-0/AI-4 審閱，**此輪沒有執行**）
1. **審核前置（不實際操作）**：AI-0 確認 #87 物理 D1 A/B、Q104/Q119 保留與合法用途、正式 app/redirect allowlist、測試者及審核者、Apple/Google 官方測試帳號/服務端身份、secret/費用/配額上限、觀測/刪除與回退程序。驗證 public repo 無私人資料，Cloudflare 現有 Worker Trigger 不能被本 PoC 接管。任何缺失繼續 BLOCKED。
2. **隔離實體環境**：需另外業主明確核准**新的** staging/test Cloudflare Worker、Auth D1 和最小權限管理員，使用合成會員、不連正式資料庫或現有 prod binding。AI-4 配置可信 origin、AppRegistry、獨立 staging namespace、managed secrets/key rotation 與限制路由；不得用 URL 包含 token、不得提交 provider 密鑰。操作後列出真正 API/evidence/reference 和回退。
3. **G02 真實 OIDC**：Apple 與 Google 各自官方 issuer/JWKS trust + kid 輪換/未知 kid/alg 拒絕、aud/azp、state+nonce+PKCE verifier、一次性 authorization code consumeCAS、code/replay/redirect/substitution 負測與真 sandbox 官方登入。保留帶遮罩摘要與官方測試記錄，嚴禁原始 access token/密碼/PII 上傳 GitHub。
4. **G03 真實 Session/D1**：先在隔離 DB 執行已批准 migrations + 回退、真 Cloudflare D1 Member/Provider/Session record；對單次與同時 2+ Worker 測試建立／refresh rotation CAS、撤權、刪除、auth_version bump、跨 App/env、read-after-commit、PITR rollback 防重入（外部不可回退 witness 必要）。計算成功或拒絕取決於資料庫實際 changes、唯一 auth writer 與法遵認可，而非 SQLite 假 fixture。
5. **證據升級**：只由 AI-0 對照原始官方 Gate + 獨立 Cloudflare/Apple/Google evidence 審查，分別記錄 `code_exists / verified_offline / verified_live / blocked`；通過 G02/G03 不自動通過其餘 Gate，更不開放正式部署或付款。失敗清除合成測試資源及測試金鑰（需授權操作），保留無機密、可追溯的測試結果與回退紀錄。

## 權限／回退
**沒有**修改 `main`、Release Manifest、Worker API、Wrangler、OIDC provider、Auth Session 原始功能、Schema/資料表、其他 AI 原始碼、現有 id-starry Trigger 或費用。僅新增純讀掃描器、CLI、Node 負測及 ADR。此 PR 關閉即可回退，無外部副作用。正式 G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false，H-Global / 外部具名 App 完全不施工。
