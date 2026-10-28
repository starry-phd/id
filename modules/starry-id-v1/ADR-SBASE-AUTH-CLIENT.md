# AI-1｜SBASE-20261028 Starry AuthClient v0.1.0 候選（只限離線契約）

依據 GitHub [#156](https://github.com/starry-phd/id/issues/156)、[AI-1 Issue #2 最新 SBASE 派工](https://github.com/starry-phd/id/issues/2#issuecomment-6459889807) 及《Starry 生態系共用技術基座 v1.0 候選版》（2026-10-28）。該基線要求共用 AuthClient/BatteryClient SDK 插槽，App 透過版本化 API 接入，不得直接存取中央 D1；套件和 Expo58/RN0.88/pnpm 等均仍是候選而非既有已通過驗證標準。

## 真正新增的工程
- `createOfflineStarryAuthClient` 和 `AuthClientScope, AuthClientPorts, AuthClientReadRequest, AuthClientCandidateObservation, AuthClientResult` 在 `src/sbase-auth-client.ts`，schema `starry.auth-client.offline.v1`，版本 `0.1.0-candidate`。
- Starry-only、App、development/staging、ios/android/web、requested scopes，嚴格欄位結構／禁止 legacy Cookie、token、Email、會員識別和未知額外欄位。App 的一切 input 都只是候選觀察；實際 verifier 和會員真實授權永遠由 DEV-D 後端決定，絕不把 UI DTO 冒充 OIDC/JWT。
- `guest` 不讀取私有服務；`getSession` 用 R21 候選後端輸出，只輸出 `session_unverified / reauth_required / guest / blocked / unavailable`。`beginSignIn` 明確拒絕（需真 OIDC PKCE）；`signOut` 只報 `SERVER_REVOKE_REQUIRED`，絕不假裝已撤銷；`getDeletionStatus` 使用 R21→R19 原始刪帳合法讀回，最多 `deletion_pending`，絕不報全域刪除完成。所有結果 `authenticated=false,private_access_authorized=false,may_grant/write/ack_queue/restore/live=false`；任何未知回應或離線錯誤安全降級，私人資訊及權限 fail-closed。
- 不含 fetch、API host、OAuth provider、Bearer token、Store、Cloudflare D1 SDK、Secrets 或原生依賴。每 App 不共用身分授權、廣告或商品 ID。不存在 live 能力或新增中央 Auth 寫入者。
- `test/sbase-auth-client.test.mjs` 使用真的 Auth 原有草稿 SQL + R21 雙讀 Session/撤權及刪帳 sealed claim，注入 **本機 sqlite :memory:** 的服務候選 port；新增離線錯誤、guest、app/env/platform/scopes、偽造資料、撤權、刪帳成功禁止及版本回應負測。保留所有舊檔和其 CI。

## API / SDK handoff for AI-4
`createOfflineStarryAuthClient({enabled:true,serverOwnedScope:{brand_id:'starry',app_id,environment:'staging',platform:'ios'},candidateAllowedScopes:['profile:read'],ports:{readSessionCandidate,readDeletionCandidate}})`，每次呼叫 `getSession({scope,requested_scopes:['profile:read']})`。讀取 ports 必須由 **Starry DEV-D 自身已授權、最新、可信的後端** 實作，R21 目前只供離線草稿 mock，不允許直接從一般 App 任意送 session_ref／member_ref。UI 能做 public guest fallback；不得因 mock 回傳 `auth_unverified` 而開啟會員資料、Battery/Store 權益。現在沒有可部署 OpenAPI endpoint，正式 scopes、OIDC/JWKS、錯誤碼、Session revocation 及 SDK package publishing 要由 AI-0/G/D 同版批准；不能自行宣稱 client 已可連線實際服務。

## Source and migration boundaries
基於中央已驗離線 [AI-0 R21 #148](https://github.com/starry-phd/id/pull/148) HEAD fbd5c03156da700b68c7b5bceb65269cb7c900ec（非 main 或已部署版本）。沿用原 `modules/starry-id-v1/src/index.ts` 身分權威、`round21-candidate-ui-auth-state.ts` 及原 schema，**沒有修改舊版、schema、R23 部署工程**。不重新開始 Echo App R22；主線 main 比 #148 落後，AI-0 必須審查合併/回退策略，禁止由此 PR 直接改 main 或部署。

## 未解／發佈禁止
R23 中央正式 Auth/OIDC/Session D1 授權和 staging 仍須真實驗證，Q104/Q119 lawful deletion/retention 與 signed P05、#87 physical A/B、KMS 和 nonrollback witness 未核准。G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false。SDK58、pnpm、Hono、RevenueCat、AdMob/Sentry 等候選不能由此型別 PR 當作 PoC 成功；公開 repo 不存真正私有產品或 secrets。不得 main merge、任何 Preview/Staging/Production、真 D1/Queue/OAuth/Store/EAS、付費；Starry Battery 永久免費、H-Global 不在本工程範圍。