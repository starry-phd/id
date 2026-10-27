# AI-1 R22｜繁星回聲新 Starry ID/Auth 候選接線與舊 Web 風險對照

基準：AI-0 R21 四組已驗 Draft #148，HEAD fbd5c03156da700b68c7b5bceb65269cb7c900ec。派工為 Issue #1 R22 comment 6449302311、AI-1 Issue #2 R22 comment 6449331972。#70 Git Tree SOP；#87 physical cross-D1 A/B 未裁決。繁星回聲已指定為新架構首款 App，但 Echo MVP、正式 App ID、Bundle ID、Store 身分與資料移轉皆尚未批准。

## 舊 Web 只讀來源：yukidu/Echo-Starry main 82cbf4f112af57fcfed12ff2f6cf86010c03560e

- src/ecosystemSsoClient.ts：舊 Web 用 id.starry.phd 中央 Session、/api/apps/echostars/ticket、/api/auth/ecosystem-exchange 換本地 token，localStorage 儲存 sq_current_user_v1；window/document focus、online 與攔截 fetch/登出事件觸發同步，遇中央離線仍可能保留舊 local 登入。這只證實舊 Web 流程存在，不可直接搬到 Expo SecureStore、RN OAuth 或新的 Starry Auth。
- src/authSessionPolicy.ts：只有該 HTTP 401 對到目前 token 時才 discard；同 id 的 local session merge 可能保留舊 authToken。這不是新 Server 端撤權或 Auth Version 的權威。
- starry-id/README.md：舊 Web Google OAuth、HttpOnly+Secure+SameSite Cookie、D1 token hash、允許 App 白名單、每 App Membership／角色及中央 Super Admin 分權。僅為舊 repo 的設計／實作文件，不能推定新版本新 OAuth、Web cookie 適合 RN，或已批准 Echo 新 app 身份。
- 舊 ticket 路徑內 echostars 只作新架構「候選」app scope；舊 _authToken／_starryUserId／Google redirect／cached member 不構成新權威。

## R22 真正新增可執行範圍

新增 src/round22-echo-candidate-session.ts：型別 EchoStarryCandidateSession 與 createOfflineEchoStarryCandidateSession().inspect(input,claim?)。版本 starry.echo.auth-candidate.v0-offline，預設關閉，只允許 Starry dev/staging + 候選 app_id echostars，明確拒絕舊 cookie/token/不受信任 origin/跨品牌與其他 App。直接調用現有 R21 createOfflineCandidateAuthUI（實際 Auth Session/Member 雙讀、Session revoked/expired/policy，及 R19/R18/R17/R16 原始 committed deletion/lease/合法性），不重寫 Auth publisher 或簽名。

因正式 Auth 001 DRAFT SQL 尚未提供已批准的新 Echo app membership schema，R22 的 echo_r22_membership_fixture 是「僅測試中」建立，使用真 SQLite JOIN Auth Sessions + Members、驗證 member_auth_version、跨 App/env 並兩次讀回；不會建立任何正式 D1 migration。就算 fixture status active，結果仍是 auth_unverified、membership unverified、privilege_authorized=false。真正官方 App membership 來源和 AI-4 server-binding 待 AI-0/業主核准。

只讀的 UI modes：guest 不讀 Auth；logout 只預覽 reauth_required **不做真正 server revoke**；session 只回 auth_unverified / reauth_required / access_blocked，不能認定已登入；deletion 即使原 Auth local committed，也只回 deletion_pending，不能認定全系統已刪。輸出只有固定 schema/app/state/membership/reason 以及全部 false 的 capability flags，永遠無 raw member、Session、OAuth subject、event ID、cookie/token/個資。AI-4 可 import 私有假資料 ViewModel 但不得公開 route 或提升權限。

新增 test/round22-echo-candidate-session.test.mjs：真 Auth 001/007/011/012/013、R16 封閉租約及一次性 Challenge + Echo fixture，以及獨立 UI SQLite memory DB；涵蓋 Guest 誤升級、Legacy Web token、跨 scope、Session 撤權/expiry/auth_version、membership 狀態競爭、合法用途、源 rollback、晚到 Session 撤權、刪帳 pending 不能繼續權限。

## 未完成／不能假冒為官方證據

R22 是可重現的離線測試，非 RN/Expo 登入實作、正式 Auth API、真正會員資料、Echo MVP/Store 設定、任何可用權限或已完成登出。仍需人類決策 Echo app_id 白名單、官方會員授權、Expo OIDC/refresh token 保管、#87 物理 A/B、Q104/Q119 合法 HMAC/KMS、真 signed P05、獨立不可回退 witness、Cloudflare D1/Queue ACK/Store/EAS/額度。G00–G10 官方 11/11 BLOCKED，P05/PUBLISHABLE=false；所有 Draft 未合併 main、不 Preview/Staging/Prod、不接真 DB/Secrets/支付或付費、不改舊 Web/HGlobal；免費 Battery 永久免費。
