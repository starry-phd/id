# AI-1｜Wave1 Round-001｜Q2=A 購買前 Starry ID 可信身分閘門（非 Store 授權）

## 此回合來源、版本與責任
- AI-0 最新 [Issue #1 四組通用啟動指令](https://github.com/starry-phd/id/issues/1#issuecomment-6466488372)、[AI-1 Issue #2 Round-001](https://github.com/starry-phd/id/issues/2#issuecomment-6466170726)、[AI-0 Wave1 工作令](https://github.com/starry-phd/id/blob/506e33d68a2b2a069b5a356c0bf4192df7db7463/docs/ai/AI0-WAVE1-EXECUTION-HANDOFF-20261028.md)、[最新機讀 Owner 決議](https://github.com/starry-phd/id/blob/506e33d68a2b2a069b5a356c0bf4192df7db7463/docs/operations/ai0-owner-approved-wave1-decisions.v1.json)、Starry 技術包 v1.2。以 AI-0 [Draft PR #186](https://github.com/starry-phd/id/pull/186) HEAD `506e33d68a2b2a069b5a356c0bf4192df7db7463` 為本 Wave1 最新決議來源，原中央 Auth/SBASE/R23/R24 實作原樣繼承。
- **Q2=A**：免費訪客可不登入瀏覽／試用，但啟動 Apple/Google Store 購買前須登入可信 Starry ID；取消登入回原來流程，不可進入商店。**Q1=A** 同 App 同 Starry ID 的跨 iOS/Android 權益是產品規則（未經 Sandbox 驗證），D07 各 App 收費隔離，AI-2 是唯一 Billing Entitlement Writer。D01=D 不代表本中央 Expo54 可升級；D02=A/Q5=B 新私有消費 App monorepo 尚未獲授權建立；D03=A RevenueCat 合約由 AI-2，D04=C/Q4=D Ads OFF。
- 不能重做已有 `sbase-auth-client.ts`（舊候選 DTO）、R23 `r23-signed-session-d1-request-boundary.ts`（真 HMAC + SQLite Session/Member）和 `r23-auth-g02-g03-live-preflight.ts`（G02/G03 只讀 Gate）。此輪實際新增的是二者上方的 **Q2 購買前身分受控入口**，不是另一套驗證器或 Store Gateway。

## 實作與呼叫契約（只在 server/mock 掛載）
`src/wave1-purchase-entry-auth-gate.ts`: `createOfflineStarryPurchaseEntryGate({enabled:true,serverScope:{brand_id:'starry',app_id,environment:'staging'},expectedOrigin,authDb,getVerificationKey})`；版本 `starry.auth.purchase-entry.w1.v1-offline`，預設關閉且 Production constructor 拒絕。輸入僅允許 `PurchaseFlowIntent={brand_id:'starry',app_id,environment,flow_ref}`（32～96 位不含 PII 的不透明暫存導航識別，**不是 Token 或 Store 購買憑證**）。
- `guestBrowse(intent)`：免費公開頁瀏覽，**零 Auth DB 讀取**。
- `beforeStore(request,intent,serverNow)`：僅用原 R23 Server 可信 WebCrypto HMAC 簽章 + 目前 Auth D1 Member/Session/Apple-Google provider 唯一綁定重查。缺／錯／過期／被撤／跨 app/session/version/brand/env 的 Request → `login_required`；取消 Starry ID 登入 → `cancelled_to_original_flow`；真正可信登入 → `identity_verified_only`，**不表示 Store 或 Billing 可執行**。
- `resumeAfterLogin(freshServerRequest,intent,serverNow)` 必須每次使用**重新授權的有效 Request**，不能拿 `AuthClient.auth_unverified` 或 App `isLoggedIn=true` 換通行證。對同一 App／同一使用者的短期續接使用 `sameVerifiedMember(previous,next,intent,now)`，會員切換則不相容。
- `readServerIdentity(result,intent,now)` 是提供未來 **AI-2 伺服端驗證的私有資料 port**，只有不可偽造 WeakMap 原件、同 flow/App/brand/env，及 5 秒內有效的真正 Auth Principal 才能讀出 `starryUserId,appId,auth_version,session_id`。UI 對外 JSON **永不輸出中央 ID／Session／Token／姓名／個資**，序列化 copy / 自稱 loggedIn / cookie 不可能取得可信 port。
- **所有 public response 永遠** `may_open_store=false,may_purchase=false,may_grant_entitlement=false,may_transfer_store_transaction=false,may_restore=false,may_charge=false,verified_live=false`。這一回合即使 Auth 合格，也尚未打通正式 Store：AI-2/AI-4 需在獲正式 Gate / Sandbox 授權後另行做真 purchase enablement，並在*任何真正交易前*重新確認當前會員、Session、Store 商品、退款、跨端/跨 App 位置及法遵。

## 測試與待決 Gate
新增 `test/wave1-purchase-entry-auth-gate.test.mjs` 使用原 Auth 001 DRAFT SQLite schema 和真正 ephemeral nonextractable WebCrypto HMAC signed Session；8～10 組實際負測：免費訪客零 DB、無登入導入 Starry login／取消不付款、帶簽章+現時 D1 綁定的唯一合法身分只取得 private proof 不取得 Store 權限、Session revoked/expired/suspended/版本不符、App/brand/env 流程 spoof、不合法 flow_ref、會員切換、新舊 WeakMap 證據失效、DB/key outage fail-closed；不接任何 Apple/Google/RevenueCat/Store。沒有新的正式 Auth Writer/Session 或資料庫遷移。
正式 G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false；#87 D1 物理分置、Q104/Q119 合法保留、真 managed KID keyring、OIDC Apple/Google JWKS/PKCE 回呼、受控 Cloudflare staging D1/Worker、Store Sandbox、退款/權益與跨端核證皆需 AI-0/業主另案 Gate。Cloudflare id-starry Workers Builds 失敗不能被 GitHub CI 代替；不部署/修改其 Trigger。

## 跨組責任與下一輪最小交接
- **AI-4 #5**：審閱 `PurchaseFlowIntent` 和 `PurchaseEntryView`，將 Guest → Starry login → 原頁續接流程只在 Offline OpenAPI/DTO 提案中接線，**不可把 `identity_verified_only` 當作 Store 開通權限**。
- **AI-2 #3**：接收 `readServerIdentity` 的**server-only 身分綁定概念**，但現在不可直接呼叫 Store；後續需要合法真正 Session 重讀、Q1 跨 iOS/Android 同 App entitlement 和 D07 跨 App 拒絕測試，真正 SKU/RevenueCat CustomerInfo 必須以 AI-2 唯一 Writer 核實，不能用 UI `starryUserId` 作信任。
- **AI-0 #1**：先確認此 Round-001 的實際原始 blobs、同 SHA CI 和 Gate，將 W1->W2 狀態寫到 #1/#156；不可默認四組聊天已執行或把這組 CI 當完成 Native/Sandbox／Production。
- Repo 仍 Public；所有更動僅在 AI-1 安全分支，無 secrets、真使用者、H-Global、額外付費、main merge、Store/EAS/Cloudflare 實體操作。撤除本 Draft 即可撤回新程式，原中央會員完整。
