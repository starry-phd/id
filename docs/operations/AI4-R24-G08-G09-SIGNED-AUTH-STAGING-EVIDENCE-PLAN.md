# AI-4｜R24 中央會員 G08/G09：真 Signed Session → HTTP read-only 合約測試與受控實體驗收方案（2026-10-28）

**正式狀態：CODE_EXISTS + VERIFIED_OFFLINE（待新 SHA CI）／VERIFIED_LIVE=false／RELEASE=BLOCKED。** 依 AI-0 [#171 R23 同版整合](https://github.com/starry-phd/id/pull/171) 與 [總管 #1 最新主審](https://github.com/starry-phd/id/issues/1#issuecomment-6461433891)、[AI-4 #5](https://github.com/starry-phd/id/issues/5#issuecomment-6461436320) 的「不再重做 DTO、優先正式 Gate」接續。不改既有中央會員業務規則；不重新匯入已納入 #171 的四 Owner／AI-0 Git Blobs；不開發任何外部具名 App。

## 1. 此次與 #166 的差異

- #166 已驗 **Cloudflare Preview 設定預檢**：正式 Worker `id-starry` 的 #164 Preview Build `239a1aaa-39ff-4e8e-b355-ccfa94edaecc` 真失敗（缺 `[previews]`），AI-0 已決定**路徑 A：維持原 Trigger 不動、不 Push 受監視 #164 branch**。本輪不重試、也不把 #166 的配置候選當 Preview 已修復。
- #171 已包含 AI-1 **真的 WebCrypto HMAC Bearer + Member/Session/Identity SQLite 準備語句** `createOfflineStarryRequestAuthBoundary`（#167，非匿名假 DTO），但**仍未接成 Worker 路由，也未經真 Cloudflare D1/Keyring/OIDC 驗證**。這次新增**直接消費該真 Auth Boundary 的 HTTP 語義安全測試，並搭配正式 `apps/api/src/index.ts` 的未啟用斷言**。
- 新 `apps/api/src/r24-offline-staging-auth-http-smoke.ts`：**僅離線測試私有合約**，實作 `GET /__r24_offline_only/session-verification` 的合成 HTTP 處理器，不匯入/修改 Worker `index.ts`、Expo Router、OpenAPI 公開 endpoint。唯一允許主機 `*.invalid`，只能 dev/staging，`enabledForOfflineHarness:true`；依 AI-1 server-owned guard **每一次**真正驗證原有簽章+穩定 provider subject+Session/member 最新 SQLite。只有已封印 `TrustedPrincipal` 才回 204 無主體，401/404/405/503 皆 fail closed；不暴露會員 ID、姓名、Session、Token、金額、內部驗證錯誤或權限。
- 新 `apps/api/test/r24-offline-staging-auth-http-smoke.test.mjs`：**真 AI-1 signer** `signServerSession`、不可匯出 HMAC CryptoKey、原 `001_starry_identity.DRAFT.sql`、物理 `node:sqlite :memory:`，準備 SELECT 最小介面與原有 guard，測 signed positive、session revoke、status suspended/deleted、auth_version、失效/損壞簽章、偽造 principal、keyring/D1 關閉、無效 header/query/Origin/method/時鐘；也直接調用既有 Worker `handleRequest` 證明**沒有**這個路由，仍 404。這是**真離線加密＋DB/HTTP 整合**，不是 live OIDC 或正式會員資料。

## 2. 可核證受控 staging 測試計畫（本輪只制定，不執行外部資源）

| Gate / Owner | 必要前置且可留存的真實證據 | 擬議隔離測試與預期失敗行為 | 本輪狀態 |
|---|---|---|---|
| G01/AI-0 | 已核准獨立 Starry staging Cloudflare 帳戶/Worker/D1、資源標識與權限分界，H-Global 零串接，正式 Owner 簽核 URL | 列出測試 Worker、preview branch/root、域名、Access、Secret scopes、資源最小權限與費用上限；不使用現有 id-starry production | **PENDING APPROVAL** |
| G02/AI-1 | 官方 Apple/Google OIDC issuer/audience/JWKS/PKCE/state/nonce、真實 sandbox 憑證、旋轉和失效證據 | 只有 AI-1 核准之測試 client ID，可在受控 staging 驗 JWKS key rotation/revocation；不可把本合成 HMAC token 當 Apple/Google 登入 | **PENDING LIVE** |
| G03/AI-1+AI-4 | 核准 staging Auth D1 的 binding、隔離 migration/rollback、依法批准 Q104/Q119、server KID keyring、只讀紀錄與撤權 TTL | 用**完全合成且無真人個資**會員，依限存續執行簽章→HTTP→D1 最新 Session SELECT→204，隨後 revoke/auth_version bump→401，DB unavailable/key rotation→401/503；對非法 brand/App/session 永不 2xx；記 commit/SHA/HTTP trace & 遮罩與審閱 | **PENDING RESOURCE + APPROVAL** |
| G06/G07/AI-0+3 | 官方單一 P05 issuer、#87 D1 A/B、法遵/保留、independent anti-PITR witness；真 Queue/DLQ 隔離 | 不因 HTTP Session 合法就允許 P05/Queue ACK；任何跨 D1／回滾前需不變的 Witness/commit-before-ACK 真演練 | **BLOCKED** |
| G08/AI-4 | 先解決 #164 Preview 事件且**另案授權**新的 Worker/Branch/config/Trigger；用最小權限且已批准的 API 完整契約 | 實測 HTTPS、HSTS/CSP/CORS、快取 no-store、未登入/過期 Session 401、跨 Origin 404、GET-only、私有資料零洩露；部署回滾對照 Build ID 與 fresh signed SHA；原 `GET /v1/health` liveness 不當 Auth 成功 | **OFFLINE CONTRACT ONLY** |
| G09/AI-4/DEV-I | 真 Expo SDK/RN/RevenueCat/AdMob/Sentry 版本、批准 App ID、EAS/iOS TestFlight、Android Internal、Web E2E、測試帳號與實際費用 | 取得當期官方 target/審核要求後，分別 iOS/Android development build & login/logout/session revoke，非使用 Web mock 代替 native；IAP/Ads/通知如屬批准產品才試 | **PENDING NATIVE/STORE APPROVAL** |
| G10/AI-0 | 真監控、成本上限、稽核、備份/復原、責任人/回滾、release_authorization URL | 在真測試執行前具備監控和回退 kill switch，超預算或 PII 外洩即停止；失敗證據留 GitHub（須遮罩敏感資料） | **BLOCKED** |

## 3. 最低授權封包，避免把 CI 綠燈誤當 live Gate

AI-0 必須**先**於 GitHub/核准紀錄（不得存 secrets）獨立確認：① 測試目的與範圍、申請人/審閱人、同一固定 Git SHA；② 專用 sandbox Cloudflare Worker/D1 與 KMS/Token 權限、**不含 production**、已批准匿名合成資料處理與保存；③ 明確 API 測試清單、安全失敗/回退條件；④ Cloudflare Builds 觸發來源與篩選分支（不得觸碰 #164 已監看分支），公網 Preview 的 Access 與 HTTPS；⑤ 費用/額度及中止/刪除沙盒確認；⑥ AI-1/AI-3/AI-2 專責簽署、Store/Queue 方案及 #87 適用決議。缺任一欄只允許純離線檢驗。

**真實正測證據格式（未執行，欄位全部 PENDING）**：`test_case_id`、`approved_sandbox_resource_ref`、`git_commit_sha`、`cloudflare_build_id`、`worker_deployment_id`、`d1_database_ref`、`http_expected_code`、`http_actual_code`、`revoke_before/after`、`expected_backend_selects`、`observed_logs_redacted`、`approval_record_url`、`cost_limit_and_actual`、`rollback_id`、`reviewer`；禁止把 token、JWS、密鑰、會員 PII、原始請求／DB rows 寫進公開 repo。

**正式停止判準**：出現任何未授權部署、真實資料、任何付費啟用、真 D1/Queue 寫入、錯誤 brand/app 作用域、未控管 Preview URL、超額、錯誤正式環境標籤，即中止並回報。恢復必須由 AI-0/業主另行授權，不能以測試成功倒推出發布權。

## 4. 回退、責任及版本

- 本 PR 只新增 AI-4 的三個獨立檔案；**關閉 Draft 即回退所有本輪變更**。沒有改 `index.ts`、真 Worker `wrangler.toml`、網域、DB、Secrets、main、Lockfile、GitHub Actions workflow、其他 Owner 檔案。
- 讀取來源：[#171](https://github.com/starry-phd/id/pull/171)、AI-1 真 [#167](https://github.com/starry-phd/id/pull/167) R23 HMAC/Auth port、AI-2 [#169](https://github.com/starry-phd/id/pull/169) Store preflight、AI-3 [#168](https://github.com/starry-phd/id/pull/168) G07 preflight、AI-4 原 [#166](https://github.com/starry-phd/id/pull/166) Preview preflight。來源 #171 的 original 16+18 Git Blobs 原樣保留，不 reimplement 或修改。
- **現有 AI-0 決議**：Cloudflare Preview 路徑 A 保持 `id-starry` 真 Trigger 不動；B 需業主新授權。D-01～D-08、D-02 private repo 都是候選，不動外部 App。免費 Battery 永遠不可銷售。
- **官方真 Gate**：G00–G10 **11/11 BLOCKED**、P05/PUBLISHABLE=false、`release_authorization.granted=false`；本輪沒有任何 `verified_live`、沒有建立正式 HTTP API 或有權限的 Session、沒有正式 Cloudflare、D1、Store、EAS、付費/部署。
