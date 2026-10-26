# AI-2｜REBUILD 第三輪 Apple／Google Sandbox Provider Verification — Gate 候選

日期 2026-10-26。基準 [AI-0 整合 Draft #35](https://github.com/starry-phd/id/pull/35) fixed SHA `c59c5dcdf97b8fdfb12b5bf76bfd8f85271febcd`。**僅離線可信 Port／Sandbox 模擬測試，Draft、不可部署、未處理真實購買。**

## 實作交付與安全責任

- `src/sandbox-providers.ts` 是 AI-2 domain-owned store attestation 候選；`StorePort.verifySandboxEvidence()` 改為允許 async，AI-1 同請求弱封裝主體仍是 `planSandboxPurchase` 先決條件。
- Apple：真正 WebCrypto **ES256 compact JWS** 簽章位元驗證、嚴格 Header（拒 `alg=none`／不受信任的 `jku/jwk/x5u`）、必須有 x5c，驗 `signedPayload`（Apple Server Notifications V2）、內層 `signedTransactionInfo` 及可選 `signedRenewalInfo` 三份 JWS；校驗簽章一致的 `Sandbox`、Bundle、SKU、originalTransactionId、transactionId、appAccountToken、有效期、退款／撤銷。**重要：本模組自己沒有 Apple PKI x5c 證書鏈、Apple Root pinning、leaf extensions、OCSP 或過期檢查的完整實作**，必須由 AI-4 在可信服務端安全完成 `ApplePkiTrust.trustedAppleLeafKey`，否則不得建立正式 Worker route。離線測試中這個 Port 是**模擬的信任鏈決策**，生成的 ECDSA Key 不是 Apple 真憑證。
- Google：真正 WebCrypto **RS256 JWT** 驗簽，只有伺服器信任的 `resolveGoogleOidcKey(kid)` 提供公鑰；檢查 Google issuer、精確 audience、期望的 Pub/Sub push service account、iat/exp，以及固定 subscription、packageName。RTDN body 本身僅含 token、通知類型；**必須透過已授權的 `purchases.subscriptionsv2.get` API 端回查**取得 `testPurchase`、`subscriptionState`、`lineItems.productId`、`lineItems.latestSuccessfulOrderId`、`expiryTime`、`externalAccountIdentifiers.obfuscatedExternalAccountId` 才能形成 Billing snapshot。原始 purchase token 不得進 entitlement/outbox/D1，要由伺服器 `opaquePurchaseTokenRef` 發行 HMAC/opaque ref。Google JWKS 來源、IAM publisher 授權、Play Developer API OAuth、request origin/anti-replay 檢查**尚未實作**；離線 RSA Key 和 Play response 是 fake。
- Billing：仍只回傳 `Plan`，**沒有 D1 寫入，也沒有實際授予權益**。同一 logical Billing D1 transaction owner claim + provider event + entitlement CAS + outbox 待 AI-4／AI-0 Gate。對 `GRACE_PERIOD/ON_HOLD/EXPIRED` fail closed；遲到退款不覆蓋新的續期；Apple revoked/refund fail closed。Apple appAccountToken／Google obfuscatedExternalAccountId 必須與 AI-1 server-side binding 對應，不得由 client 提供會員 ID。
- P05：維持 AI-0/AI-3 第三輪共同統一，不擅改稽核 owner 的事件 schema 或 Queue。前輪 `billing.p05.v1-candidate` 尚非核准正式規格；只有**真已驗 Provider、持久 Billing 交易與 outbox commit 後**才可能輸出可投遞事件。
- 商店環境與 Worker 運行環境分離：**只允許 Worker development/staging × Store sandbox**。拒絕 Production Store 或 Worker，Battery 永久免費不設可購買 SKU。沒有 H-Global 實作。
- 本輪限制：沒有 Apple／Google 正式 Sandbox 商店憑證與裝置實測，沒有真正的 provider TLS/API、StoreKit/Play Billing app callback，無正式 D1、Queue、Secret、Cloudflare／App 佈署，不能聲稱完成「真實商店驗證」或能收款。IAP 自建 vs 代管仍是未核准 ADR。

## 官方協定依據
- Apple: https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2
- Apple JWS header x5c: https://developer.apple.com/documentation/appstoreservernotifications/jwsdecodedheader
- Google RTDN: https://developer.android.com/google/play/billing/rtdn-reference
- Google Developer API Subscriptions V2: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2

## 狀態／跨 Owner Gate
- AI-0 #1：供應商/費率/商品 SKU、付費資格、返還和 Grace 策略、實體 D1 拆分、唯一 P05 event/schema/retention、完整需求核准追溯 Gate。
- AI-1 #2：真正 Starry ID OIDC/JWKS/Session／Member 狀態 + server-owned Apple/Google 綁定／假名 actor-ref；本 PR 不修改 AI-1。
- AI-3 #4：Outbox→Inbox 去重、重送與復原、Audit P05 canonical；本 PR 不修改 AI-3。
- AI-4 #5：可信 Apple PKI x5c chain verifier、Google OIDC JWKS/cache、實際 Play Developer API/Apple Server API、Pub/Sub IAM push 端點及驗證、Workers/SDK/EAS 原生裝置測試、真 D1 commit/recovery；本 PR 不修改 AI-4。

所有跨模組驗證目前以 GitHub CI **相同 Head checkout 的 TypeScript/Node/SQLite** 為準；絕不以離線 generated-key mocks 當真商店成功或 Gate 放行。
