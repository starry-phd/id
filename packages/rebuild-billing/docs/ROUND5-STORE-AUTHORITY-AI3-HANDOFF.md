# AI-2｜第五輪 Sandbox Store Authority + Committed Billing → AI-3｜Gate 候選

日期：2026-10-26。基準：[AI-0 第四輪總合流 Draft #46](https://github.com/starry-phd/id/pull/46)，固定 SHA `bacc0166bf4e1070a4696c7bc109197b4c642f9f`。**所有程式僅離線／候選，絕不能將 PR/CI/TEST P05 視為真實商店驗證或上線核准。**

## Apple：實際 PKI 候選，仍非 Apple 官方驗證

`src/apple-pki-node.mjs` 使用 Node `X509Certificate`，**不是 Worker-compatible library**。它對提供的 `x5c` 三段 DER 作完整鏈簽章檢查，root 必須與服務端指定的 DER pinned root 相同，leaf/intermediate 的 issuer/subject、CA flag、EC P-256 key、證書效期皆必須正確；依 Apple 官方 SignedDataVerifier 類比，驗 leaf `1.2.840.113635.100.6.11.1` 與 intermediate `1.2.840.113635.100.6.2.1` X509 extensions（不是 raw string 搜尋）。須經服務端 `verifyOcspEvidence` 確認 good + 未過期才交付 leaf WebCrypto key 給原第三輪 `verifyAppleSandboxSignedTransaction`。任何 OCSP 中斷／撤銷／過期都拒絕。

**仍未完成：** 本 PR 不附 Apple 官方 root，未建立可驗證簽章的真 OCSP responder 驗證器（`verifyOcspEvidence` 是後端信任 port，僅測試 callback），未實現 Worker 的 Node X509 兼容性、安全 Fetch／root rotation、Apple App Store Server API 真資料。離線測試用 OpenSSL 在 CI 暫存目錄建立 root→intermediate→leaf，生成真 ES256 JWS；**自簽測試憑證絕非 Apple 官方信任鏈，正式驗證 Gate 保持 BLOCKED**。Apple 官方 Node 函式庫可作 AI-0/AI-4 後續整合與依賴核可依據：https://github.com/apple/app-store-server-library-node 。

## Google：授權後端 Play 重新查詢候選

`src/google-play-requery.ts` 僅允許 Starry Sandbox backend 提供 `obtainServerToken` 與 `fetchTrusted`，固定 `GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{packageName}/purchases/subscriptionsv2/tokens/{token}`，拒絕不符 package、token path traversal、無效 service token、HTTP 403/404/429、來源不可達、無法 JSON decode 和不符合 subscriptionsV2 型式的資料。從 API body `lineItems`、`subscriptionState` 傳回不自行捏造 paid 狀態；原第三輪 Google RTDN verifier 仍要檢查 testPurchase、SKU、所有權綁定，且只能使用 `GooglePubsubTrust.querySubscriptionV2` server-owned port。

官方參考：https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get 。

**仍未完成：** 伺服器真正 OAuth `androidpublisher` token exchange/JWKS、Play Console IAM service account、TLS 連線網路、商店 Sandbox 測試交易與採購、Pub/Sub push route；此 Port 的固定來源和 fake fetch 測試 **不能證明 Google Pay 已驗證**。

## Billing D1 → AI-0 P05 → AI-3 Queue

- `src/billing-d1.ts` 保留第四輪五段同域 D1 `batch()`：owner first-claim→event→entitlement CAS→metadata-only outbox→last CHECK guard；新增 `afterCommitOrder({brand_id,app_id,environment},eventRef)`，從已提交 receipt/event、當前 entitlement 所屬版本的 **真正 DB read**，只返回 `current|superseded|unknown`。無確定次序或 DB 不可達時不 ACK，不以 client 時間戳、`committed=true` 當事實。
- `test/round5-ai3-integration.test.mjs` 在同一 checkout 實際 import AI-1 `createServerIdentityResolver`、AI-2 `planSandboxPurchase`+D1 writer、AI-0 13 欄 `isCandidate`、AI-3 `createRound4BillingAuditConsumer` 與 `dispatchQueueMessage`。以 test-only injected authority 組合，證實 **先 commit → Audit inbox ACK**、相同鍵 duplicate 無二次新增、舊事件 superseded → quarantine、未知順序 retry→DLQ（僅持久化後才能 ACK）、來源不可達與 AI-0 deny 不 ACK。
- 注意 AI-0 來源碼 `PUBLISHABLE=false`：測試自製的 `accepts: isCandidate` **只用於離線測試**。真實發事件權限不是形狀驗證，AI-0 Gate0/1 未核准之前，不得将測試 authority 複製到 Worker、啟動真 Queue 或給任何會員付款權益。
- `afterCommitOrder` 是保守判定：最新投影的 `applied_event_key` 相同為 current；較新的 `last_effective_at` 才是 superseded；其餘 unknown。**不能以時間排序覆蓋更近的退款、chargeback、權益 CAS**。真正 D1 多連線並發、跨域 Queue ACK/一致性/DLQ 持久、隱私保留、資料修復前提仍未驗收。

## 最新 DEV-I Google Docs 的 EAS 成本規則

2026-10-26 最終版：Expo/EAS Free 優先、每 PR 必要型別／Lint／安全／Node/SQLite CI，**不預設每 PR EAS 原生 Build**，但未來登入／IAP／推播真原生必要測試不可省；EAS Build/Update/Workflows 分開計量、未經核准不得升級或花費。這一輪沒有 EAS Build／Update／Workflows、Cloudflare Preview、正式 D1、真 Store API/付款、任何 Secrets 或正式部署。

## 待 AI-0 判定與各 Owner 交接

- AI-0：Apple 官方根憑證官方取得/輪換、驗簽與 OCSP 策略（建議研議 Apple 官方 SignedDataVerifier）、Google OAuth/JWKS/Play IAM、P05 13 欄候選是否核准（仍未核准）、訂閱商品 SKU/退款/Grace、D1 物理架構、SSOT。
- AI-1：只由真實 Session/會員當前版本發出 WeakSet principal，Store account binding 為後端資料權威；不得 client 偽造。
- AI-3：用 AI-2 可信 D1 `readAfterCommit` 與 `afterCommitOrder` 驗真正 provider 後已提交事件，不可把 AI-0 test-only allow 當 production release；Audit 本身是 AI-3 writer。
- AI-4：Apple Node-only PKI port 不可直接作 Worker adapter；須先核准 Cloudflare Workers 支援、可信 Root/OCSP、Google API/JWKS/Publisher 身分、D1 migration/權限/backup、Queue DLQ、Expo EAS Build／真機及 Store Sandbox 測試 Gates。正式 API 仍不能啟用 Billing endpoint。

Starry Battery 永久免費、H-Global PAYUNi 不在此 repo／本功能，禁止付費、部署、正式 DB、main merge。所有成果留 GitHub Draft PR、固定 SHA 與真 CI 證據。
