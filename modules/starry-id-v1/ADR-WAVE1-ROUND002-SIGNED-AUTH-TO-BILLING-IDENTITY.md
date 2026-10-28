# AI-1｜Wave1 Round-002｜Server signed Auth → Billing 身分審閱契約（離線）

權威基準：AI-0 已整合並經同 SHA 3/3 GitHub Actions 通過的 Draft #191 HEAD 84a23e6ed31fd5a91675ac46b3ab012d01567df6；Round-002 指令 GitHub Issue #2 comment 6467062015；AI-0 Issue #1 comment 6467052301；技術基座 v1.2。保留已整合的 AI-1 #189 購買前 Q2 身分閘門、AI-2 #188 RevenueCat mock policy、AI-3 #187 稽核、AI-4 #190 API，不另建立 Auth Writer 或改動其他模組。

實作：新增 createOfflineWave1BillingIdentityBridge（src/wave1-round002-auth-billing-bridge.ts），契約 starry.auth.billing-identity.r002.v1-offline，預設 disabled，production/H-Global 拒絕。每次 reviewFresh(signedRequest,scope,now,previous?) 執行原 R23 真 HMAC 簽名 Session、目前 Member/Session/Provider SQLite D1-shaped 三重重讀和 AI-1 Q2 入口閘門。不能從 client 的 loggedIn、userId、cached AuthClient、任何 member_digest 生成 Auth。沒有登入回 login_required；金鑰故障或 scope 非法回 blocked；原帳號與新帳號不符回 member_changed。登入身份通過也只回 identity_review_only。

安全摘要：額外獨立的 server-only 不可匯出 HMAC SHA-256 key，針對 contract + brand + app_id + environment + signed and current Starry ID 做域分離摘要 m_<64hex>，不能跨 App/環境直接套用。唯一 server-only readServerReview(originalResult,scope,now) 透過 WeakMap 原物件，最多 5 秒，kind=signed_auth_d1_review_only，包含 digest/auth_version/expiry/active session；verified_live=false、billing_authorized=false。Public JSON 永不含 Member/Session/digest/Token/PII；全程 may_purchase/grant/charge/restore/open_store/ack_webhook=false。

刻意不使用 AI-2 目前 OfflineIdentity.kind=offline_auth_fixture_only，避免以新資料偽裝舊 mock。AI-2 #3 是 Billing 唯一 Writer，需要獨立審核型別／使用者摘要與 RevenueCat App User ID 的安全映射，重新認證最新 Session，具體商店商品、退款、restore、同 App 跨 iOS/Android 合規與正式 sandbox 另行核准。此 AI-1 Bridge 不認證任何 Apple/Google Receipt，不會啟動交易。

安全實測：新增 node:test 真 SQLite :memory: 001 Auth schema、真 WebCrypto HMAC 雙鑰、假 digest、跨品牌/app/env、撤權、停權、刪帳、member account-switch、version drift、Session expired/rotate、密鑰與 D1 outage、範圍與 WeakMap 物件複製／逾時負測。所有 existing schema/source/workflow 不變。AI-4 #5 只能取得匿名 UI 狀態，不得把 server-only digest 放入 public OpenAPI。

正式 Gate1 仍 PARTIAL/BLOCKED、Gate2 上輪 OFFLINE PASS，Gate3 Release G00～G10 11/11 BLOCKED，P05/PUBLISHABLE=false。真 OIDC/JWKS/PKCE、Cloudflare D1、KMS/key rotation、Q104/Q119/#87、Store Sandbox/RevenueCat、P05 signed issuer/Queue durable ACK、Native Builds 未核准。Cloudflare id-starry Workers Builds 原 FAIL 分開記錄；本 PR 不部署、main merge、不收費、不改 Expo54、不建立 Q5=B 延後私有 Consumer Monorepo，H-Global 暫停。AI-0 下輪先驗收原始 Git Blob/SHA/CI，再裁決 AI-2 接線 Gate1；AI-1 可依 #4 的新派工補 SessionFence 事件綁定離線契約。