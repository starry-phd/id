# AI-4 M1 Starry-only staging capability review pack — NOT AUTHORIZED / NOT PROVISIONED

Authority: latest development standard integrated v1.0 (2026-10-29) and its owner decisions/S2 additions (2026-10-30), workflow v3.0, UP-01/02/04/09/10/13/15/17/18/19/20/22; GitHub Issue #220, AI-0 #1, AI-1 #2, AI-4 #5.

This document is a **proposed finite resource pack**, not a request to create resources and **not** a claim of deployment, live identity or expense approval. The owner has indicated a US$10/month *additional-cost preference*, excluding existing subscription charges. This is neither a provider-enforced hard cap nor a blanket approval to spend.

## Evidence baseline (AI-0 read-only inspection; do not duplicate or extrapolate)

See https://github.com/starry-phd/id/issues/220#issuecomment-6511951607 .
The existing Starry id-starry Worker reports bindings=[]; two older preview Workers have no D1 binding. The two D1 databases identified by AI-0 belong to Echo/legacy, not central Starry membership. Do not read their data, bind them, clone them or reuse them. No verified Starry-specific central D1 was found. The owner reports existing Workers Paid US$5/month; billing plan, usage, quota and prices are **not yet billing-verified**. The existence/settings/redirects/consent of a Google OAuth Client are unverified. No account IDs, client secrets or credentials should be posted publicly.

## Precise Starry-only proposed resource mapping (all PENDING)

| Component | Proposed identity / environment | Scope and blocking preflight |
| --- | --- | --- |
| Cloudflare account | Existing Starry-owned account, ID and roles to be verified read-only | Brand=starry, app_id=starry-id, environment=staging; verify owner, roles, current plan, existing named resources and remaining allowance |
| Worker | Proposed NEW id-starry-m1-staging; NOT existing id-starry | Limited to approved test identities and exactly reviewed source SHA; builds remain disabled; no general public membership route |
| D1 | Proposed NEW id-starry-m1-staging-db, isolated from other brands and production | Sole authority for M1 test member, identity, Session and minimal audit; migration and transaction semantics review before remote apply |
| Binding | Proposed STARRY_SESSION_DB, only on this Staging Worker | No actual binding exists; obtain and verify resource mapping, strict app/environment, no production alias or access to Echo/legacy |
| Google OAuth | Preferred first official test provider; OAuth project/Client/redirect unknown | Verify issuer, client type/audience, approved HTTPS redirect, PKCE/state/nonce, consent tester, revoke rights; test identity credentials controlled only by owner |
| Callback | Prefer *research* workers.dev for HTTPS + valid Google OAuth redirect | No route/DNS/Worker is approved. If invalid or unsafe, propose separate subdomain for owner approval rather than silently changing existing DNS |
| Managed keyring | Starry-only, non-extractable signing keys and versioned KID; storage unselected | Verify available provider and secure binding/rotation/revocation before any real Session issuance; no keys in Git |
| API/SDK/App | Exact five fields: s_user_id, display_name, directory_opt_in, display_name_public, profile_revision | HTTPS, Starry-only auth/App/env; local platform transport and SDK are source-only. No production route. Expo54 maintained unless a real upgrade trigger |
| Test access | Owner and explicitly named dedicated test identities ONLY | Plan least privilege, explicit invite allowlist, access/audit logs, emergency revocation; no authorization to open public staging |
| Time window | Limited M1 testing period to be selected by owner | Expiry, log retention, cleanup, resource shutdown and rollback are required before creation |

## Data protection and capability gate

M1 local OAuth attempt SQL is DRAFT only and cannot be applied remotely without encrypted code_verifier-at-rest, time-limited cleanup, Google trusted JWKS, provider-specific subject mapping, real managed keyring, approved D1 transaction semantics, least-privilege access and revocation tests. Never link users by email/name or reuse H-Global/Echo member DB. Tests must reject wrong issuer/audience/nonce/state/expiry, app/brand/env and bearer replay, inactive user, token version bump, expired/revoked Session and wrong permission. Preserve source audit, do not output identifiers or secrets in public CI.

General member personal data deletion, necessary legal retention, backup/PITR restoration and anti-regrant controls require approved Q104/Q119 matrix; no permanent email/phone/device fingerprint retention. Battery is permanently free. Initial Battery bonus remains PENDING eligibility review, never pre-granted when anti-repeat legality is unresolved. Ads OFF; no RevenueCat/Store test product creation.

## Cost and stop rules (amounts intentionally PENDING independent verification)

| Cost source | Known evidence | Before authorization |
| --- | --- | --- |
| Cloudflare basic subscription | Owner reports Workers Paid US$5/mo (unverified by billing) | Verify bill and included quotas; existing baseline is not part of *additional* US$10 intention |
| Worker requests, CPU and logs | No newly authorized Worker; incremental amount unknown | Forecast test volume, CPU, retry/log amplification, rate and billing cap availability; CPU time limit is not a total bill cap |
| D1 reads/writes/storage/backups | No authorized central Starry M1 D1 | Estimate reads/writes, storage, time-travel recovery, rates/overages and quota enforcement |
| Google OAuth, domain and operations | Provider state unknown | Verify plan, credentials and any paid product or domain |
| Actions/Expo | CI alone does not prove zero costs | Verify current plan, minutes/quotas, optional jobs and stop conditions |

If prospective *additional* spend approaches or exceeds US$10/month, suspend optional, controllable tests and request a new owner decision; do NOT upgrade or accept charges autonomously. Do not claim a hard financial ceiling absent platform confirmation. Already incurred/lagged or fixed charges may continue even after suspending tests. Stop path: stop optional load and OAuth callbacks; remove test access/credentials; disable staging routing; preserve approved redacted audit; then review actual resource cleanup and deletion/anti-PITR evidence. Any remote delete/Cloudflare account mutation requires separate explicit approval. Git revert cannot restore remote Workers Builds safety settings.

## Formal review and remaining evidence

To request resource setup, AI-0 should first present verified account/resource/roles names, Google redirect/client status, tester allowlist, exact monthly cost/maximum usage and stop/rollback proposal, then obtain item-by-item owner approval. Until then: account/read-only inventory is informational, source-only M1 transport+SDK is not enabled, and staging is NOT provisioned. Gate G00–G10 all remain BLOCKED. P01/P02/P07/P08/P09/P10 and G01/G02/G03/G08/G10 require independent runtime/provider/remote evidence when authorized. No H-Global/Echo development or shared data.


---

## AI-4 2026-10-30 唯讀資源查證與申請前缺件補遺（Source-only，NO-GO）

**依據：** [AI-0 Issue #5 工作令 #6515993242](https://github.com/starry-phd/id/issues/5#issuecomment-6515993242)、[Issue #220 最新 Work 交接](https://github.com/starry-phd/id/issues/220#issuecomment-6515760501)、《最新開發技術規範》2026-10-30 S2 UP-17/18/19/20/21/22，與官方 [Google OAuth Web server 規範](https://developers.google.com/identity/protocols/oauth2/web-server)、[Cloudflare Workers/D1 定價](https://developers.cloudflare.com/workers/platform/pricing/)。前述 #285 五位 Owner 同樹 CI #41008691181 成功，是**本地程式驗收**，不等於真 Google／remote D1／Staging 成功。**此補遺沒有授權或執行任何雲端變更。**

### 1. Cloudflare starry 連線實際 GET 現場觀察

全部查詢限 Cloudflare 連線名稱 **starry**（帳戶顯示名稱 starry.phd@gmail.com），未切至 H-Global/其他帳戶；**只有 GET**。公開 Repo 不刊出非必要帳戶 GUID、Workers 子網域完整值、Test identity、Secret、憑證、個資或任何 D1 rows。

| 實際查詢 | 真實結果（2026-10-30） | 經核對的含義 |
| --- | --- | --- |
| GET /accounts 與單帳戶 details | HTTP 200；唯一獨立 Starry 帳戶、account type standard | **帳戶存在 verified**；standard 並不代表 Workers Paid 已驗或可以操作 Billing |
| GET /accounts/{id}/workers/scripts | 200；既有 echo-starry、id-starry、兩個舊 AI preview 與兩個 bridge；**沒有** id-starry-m1-staging | **候選 staging Worker 不存在**；既有 preview/echo 不可挪作會員服務 |
| GET /accounts/{id}/workers/scripts/id-starry/settings | 200；bindings=[]、compatibility_date=2026-10-24 | 現有正式 Worker **無會員 D1 binding**；不得觸動 |
| GET /accounts/{id}/workers/scripts/id-starry-m1-staging/settings | HTTP 404 / Cloudflare 10007 Worker 不存在 | 新測試 Worker 仍只是 proposal |
| GET /accounts/{id}/d1/database | 200；僅有 echo-starry、echoes-legacy-archive-20261030 | **不存在 Starry-only M1 D1**，不可讀/寫/借/綁現有 Echo/legacy D1 |
| GET /accounts/{id}/workers/subdomain | 200，帳戶有 configured subdomain | **只證明 subdomain 存在**，不代表新 Worker route/HTTPS callback/Google redirect 註冊或 Access 准入通過 |
| GET /accounts/{id}/access/apps | HTTP 403 / Cloudflare 9999：access.api.error.not_enabled | **重要實際缺件：Cloudflare Access 尚未啟用**。不得以既有 Access 保護測試站作為設計假設；若想啟用需另行審核費用、存取規則與 Google callback 相容性 |
| GET /accounts/{id}/subscriptions | HTTP 403 / Cloudflare 10000：目前連線無 Billing Read/Write Scope | **無法查證**帳單、已訂方案、可用 Worker/D1 共用 quota 和新增費用；403 不代表沒有訂閱 |
| Google Cloud OAuth/Consent Console | 本次沒有可用且經驗證的 Google Cloud OAuth Client 管理連線/唯讀清單 | Client/authorized redirect/issuer/audience/tester invitation **仍未知**；業主已備專用測試身分僅屬業主自述，未經 OAuth login/MFA 查驗 |

**修正真實文件不一致：** 原包把 D1 名稱寫成 id-starry-m1-staging，但現有 [機器可讀提案](AI4-M1-STAGING-RESOURCE-CAPABILITY.v1.json) 的 proposed_name 是 **id-starry-m1-staging-db**。本 PR 僅修正原包該一處為 id-starry-m1-staging-db，避免 AI-0 以不同別名申請錯誤資源。機器可讀提案本身仍是**尚未授權的 proposed-policy 快照**，其 account_verified=false 等舊欄位**不能被誤讀成否定本次 GET**，亦不得擅自把 permission/staging_ready/Gate 設為 true；若要調整 machine-readable schema，需獨立受審演進。

### 2. 受審唯一資源/權限映射（全部 PENDING，不可執行）

| 項目 | 候選確切別名與隔離範圍 | 下一道可查證材料 |
| --- | --- | --- |
| Account | 既有 Starry 帳戶（starry.phd@gmail.com），不得改到其他品牌；最小角色 | Cloudflare account membership/roles、Workers Paid 實際帳單、目前請求/D1/logs 用量 |
| Worker | **id-starry-m1-staging**；獨立於 production id-starry | 新建本身需要業主逐項批准；僅 staging/source digest；外部 Builds 保持封鎖 |
| D1 | **id-starry-m1-staging-db**；binding **STARRY_SESSION_DB**；唯一 Starry M1 member+identity+Session+minimal audit authority | approved migration、同帳戶唯一 resource mapping、D1 SQL atomic/CAS/rollback 的 remote test，禁碰 Echo D1 |
| Scope | brand_id=starry，app_id=starry-id，environment=staging | 錯品牌、Production、未知 app/host/source 預設 DENY；不允許 alias 偷渡 |
| workers.dev callback | **候選 URI 模板（非真 URL）**：HTTPS scheme + Worker id-starry-m1-staging + 已配置帳戶 workers.dev 子網域 + path /v1/starry-id/oauth/google/callback | Google Cloud Auth Platform **Web application** Client 實際允許的 authorized redirect URI 必須與 callback **逐字匹配**；需確認 workers.dev 可被該 Client 接受、Host/TLS/路由正確且可做只限指定測試者。不能以 GET account subdomain 200 當作 callback 成功 |
| Callback fallback | 如 workers.dev 被 Google 或存取保護限制，另行提出 **獨立 Starry 測試子網域** | 再由業主核准 DNS/certificate/OAuth redirect；禁止自行新增 DNS 或使用 id-starry production |
| Google OAuth | Google 優先（Apple 留待後續）；以 test-only、server-side code flow；AI-1 既有 PKCE/state/nonce、pinned issuer/JWKS/audience | 業主透過 Google Console 唯讀確認 Client **存在與否**、project/consent/tester/redirect 的非敏感摘要；密碼、MFA、Client secret 值不得貼 GitHub |
| Secret custody | 候選名 **STARRY_M1_GOOGLE_OAUTH_CLIENT_SECRET、STARRY_M1_PKCE_AES_KEYRING、STARRY_M1_SESSION_HMAC_KEYRING**；**命名僅供討論、未實際建立或接線** | AI-1/AI-4 核對正式 runtime binding 名/加密 API、非可匯出 key、KID 版本/輪替/撤權與保管人；不可把 secret 放 env 檔、PR、CI log、URL |
| Tester access | 只有業主及指定專用測試身分，伺服器端 Google subject 驗證、allowlist、短效 session/deny-unlisted；必要的前置邀請/流量閘 | **目前 Access 未啟用**；AI-0 必須選定經授權的 Access 方案或受審 server-side invite/subject allowlist。**Google consent test users、前端隱藏連結或只靠 Email 不是 Worker 測試站存取閘**；未登入 callback/state 的保護另需設計 |
| Review/rollback | 指定部署來源 commit+artifact digest、審核窗口、成本警戒與清理負責人 | 測試時限、最小去識別 audit、Webhook/Queue/log 保留、逐資源刪除/Key revoke 與 remote PITR／法律保留證據；不得以 Git revert 假稱回復 Cloudflare Builds |

**Google 官方限制：** HTTPS Redirect URI 必須與 Client 允許 URI 精確符合（scheme、大小寫、path、trailing slash）；Host 及公用 suffix、禁用 userinfo/fragment/不安全 query 等受規則檢查。Google 官方文件沒有對**目前尚不存在的新 Worker callback**給任何允許證據，workers.dev **仍是可行性研究，不是已核准 URI**。

### 3. 費用與最小受控試算（避免把暫估 $0 當預算授權）

Cloudflare [官方 Workers Paid Standard 參考價](https://developers.cloudflare.com/workers/platform/pricing/)（頁面更新 2026-10-02）為：Workers 每月前 10,000,000 requests 與 30,000,000 CPU milliseconds 包含，超額各為 **US$0.30／百萬 requests**、**US$0.02／百萬 CPU-ms**；D1 每月前 25,000,000,000 rows read、50,000,000 rows written、5GB storage 包含，超額各為 **US$0.001／百萬 read rows、US$1.00／百萬 write rows、US$0.75／GB-month**。**此為公開參考而非目前帳戶的現有付費方案或剩餘配額。** 共享 quota 可能已被既存 Echo Worker/D1 等其他應用佔用，不能把各新資源獨立算成另一份免費額度。

**僅供審核的假設性負載（非已授權執行）：** 每日 2,000 測試 request ×30日 = 60,000 requests/月；每次平均 CPU 10ms → 600,000 CPU-ms/月；若每次 10 D1 rows read、2 rows write → 600,000 read、120,000 written/月；新增儲存示例 50MB。此為量級模型，**非真 D1 row metrics**，還未算 Access、Google 第三方功能、日誌採樣、Queue/retry/錯誤流量、Actions/Expo 或額外域名。實際**新增月費預測保持 UNKNOWN，不宣稱 US$0**，因 Billing API 403、基線及 Access 費率未知。

**業主已選 US$10/月「新增支出預算意向」不含既有 Workers Paid 基本費，但不是 provider 硬上限或本輪支出許可**。AI-0 執行前須列：已付帳單／可共用額度／各項新增月費與超額率／適用條款與出帳延遲／是否能真的硬性限制總帳單（**目前未驗**）。可建議**待審控制目標**：特定測試者、有限測試日數、日/每分鐘 request budget、每次 CPU 時限、失敗重試節流、每日用量/告警與超預算前停止可控測試；這些都**不是已配置的限額，更不保證帳單零超額**。

### 4. AI-0 下一個具體受審 Gate 與停用回退

1. **Preflight READ-ONLY（本輪已做）**：Cloudflare 只讀帳戶/Worker/D1/subdomain/Access/Billing metadata、S2/Google/Cloudflare 官方文檔；不讀 Echo D1 資料。
2. **Gate A — 授權申請包**：先取得現行帳單/方案及剩餘 quota、Google Client/redirect/testers 非敏感證據、Secret/keyring 託管和 least privilege role、Access 替代選型和 OAuth callback 兼容證據、總費用/警戒/停止/清理人員；**少一項即不得建立/部署**。
3. **Gate B — 業主 item-by-item 核准後**，AI-0 才能逐項建立新的唯一 Worker、D1、binding、OAuth client/redirect、受管密鑰與 allowlist；先驗無未授權者可讀本人資料，驗 GET/PATCH/logout 對同一真 D1/Session 操作而無越權；不得把 local Miniflare5 CI 當成此 Gate。
4. **Gate C — 實際 remote 端到端驗證**：指定 Google test identity 完成 code+state+nonce+PKCE、issuer/JWKS/audience → 受隔離 Starry D1 Session → 本人五欄 GET → If-Match CAS PATCH → logout → 舊 bearer 401；錯 scope/tenant/host/redirect、過期、撤權、舊 KID、D1 失敗/重試、未指定測試者拒絕與成本監控真驗證。記錄 exact source/Worker artifact/DB binding 非敏感證據，仍由 AI-0 判 Gate，不自動解除 G00–G10。
5. **STOP：** 由授權人停測試流量和登入/邀請入口、撤測試身份/session/key，停可控 retry/queue/告警流量，保留依法必要且去識別稽核；**不能靠 git revert 自動停 Cloudflare Builds 或取消第三方計費**。已發生的滯後請求可能仍計費。
6. **CLEANUP（另需審核）**：分項批准後才撤 staging route/OAuth Client/Worker/D1/secret/test data/Access 設定，並與 Q104/Q119 法定保留、備份/Time Travel/anti-PITR 核對；絕不改刪既有 production id-starry 或 Echo/legacy D1。

### 5. 最小 AI-0 決策表（**不重問已定六題/S2**）

| 原缺件 | 可驗證結論 | 下一個審核條件 |
| --- | --- | --- |
| 帳戶與現存 Staging | Starry account **verified**，新 Worker/D1 **not present** | 核准具體唯一別名／binding／部署角色 |
| Google Client/Callback/Testers | **UNKNOWN**（tester 備妥是業主自述） | Google Cloud Console 既有 Client/redirect/consent/timing 非敏感核對與業主自行 MFA |
| workers.dev 能否註冊 Redirect | **UNKNOWN**（帳戶子網域已存在≠可用 callback） | Google Web Client 逐字 authorized redirect 與 TLS/可控訪問保護方案 |
| Cloudflare Access | **NOT ENABLED**（403 Cloudflare 9999） | 另審 Access 或 server-only allowlist，否則 NO-GO |
| Workers Paid／成本硬限額 | **UNKNOWN**（Billing Read 403 Cloudflare 10000） | AI-0 補帳單/用量/價格/費用上限能力證據；每項新增支出另核准 |
| Secret custody／Remote E2E | **NOT CONFIGURED/NOT VERIFIED** | AI-1 Key KID/Rotation/secret 存取及真的 Starry-only D1 workerd/SHA/撤權 E2E |
| main／staging／正式 | **未授權 AI-4 合併或部署** | AI-0 總管逐 Gate 審核；G00–G10 **全部 BLOCKED** |

**結論：STAGING NOT AUTHORIZED、GOOGLE NOT VERIFIED、ACCESS NOT ENABLED、COST NOT VERIFIED、NO REMOTE MEMBER DATABASE、RELEASE BLOCKED。** 本次只有能力查證與受審文件，沒有建立或修改任何 Worker/D1/Access/Google/secret/賬單/ruleset、無會員資料操作、無新費用、無部署。
