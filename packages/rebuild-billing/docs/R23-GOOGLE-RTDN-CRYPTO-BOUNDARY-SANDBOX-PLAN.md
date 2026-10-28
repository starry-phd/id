# AI-2 R23｜Google Play RTDN 真 RSA 簽章接收邊界（僅離線，不是 Store 權益）

## 本輪實作與權威邊界

- src/r23-google-rtdn-signed-transport.ts 真正使用 Node crypto RSA-SHA256 verify 對 Google Pub/Sub Push OIDC Bearer JWT **以外部注入的合成測試公鑰**做簽章驗證；驗 JWT alg/kid、Google iss/aud/Email/email_verified/sub/iat/exp，解 Pub/Sub base64 DeveloperNotification，核對 App package、subscription 與事件種類。沒有新 HTTP route、沒有真 Google JWKS、沒有 Play API、沒有 Store/Cloudflare、沒有憑證或私人資料上傳。
- test/r23-google-rtdn-signed-transport.test.mjs 每次 Node CI 執行產生臨時 RSA 測試金鑰，以 crypto.sign 實際製造測試 JWT、負測竄改/演算法混淆/非官方 email/跨 App/到期/退款/重播，絕不提交金鑰或個資。**純本地測試 RSA 有效不表示 Google 官方金鑰可信**，回傳只能是 signature_checked_offline_only。
- 所有輸出 can_grant、can_restore、can_remove_ads、can_ack_pubsub、may_publish、live、store_entitlement_active 一律 false；即使通過簽章，也永遠不能當成購買成功或發放去廣告權益。Starry Battery 永久免費。

## 官方來源（2026-10-28 查核）

- https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions （Google Pub/Sub Push JWT 須驗證簽章、aud、Service Account Email 與 email_verified）
- https://developer.android.com/google/play/billing/rtdn-reference （Google Play RTDN 訂閱、單次商品、Void/Test 類型及 packageName 格式）
- https://developer.android.com/google/play/billing/getting-ready （Google Play 明示 RTDN 表示狀態變化，必須再呼叫 Play Developer API 查完整交易狀態）

## 必須先經 AI-0／業主核准的隔離 Sandbox 驗收計畫（本 PR 完全沒有執行）

1. 先決定 D-03 RevenueCat vs 自建 Google Play Store server 的唯一權威及 API/成本/Exit Strategy；批准另立真正隔離 HTTPS 測試端點、Pub/Sub Service Account、Subscription、最小權限、符合 Q104/Q119 的保存/清除時間。
2. 獨立驗 Google OIDC 官方 JWKS 信任來源、KID 輪換/快取與過期，核對正式 aud、email、iss 與 service-account 權限。不能用本 PR 中合成 RSA 公鑰冒稱 Google 金鑰。
3. 經批准後在 Test Store 非正式帳號實測 RTDN 退款/撤銷/續訂/恢復、Play Developer API 正式查詢與 app/package/交易唯一性；使用合成/測試資料。評估測試帳號、API 額度、可能費用與回退，**未取得批准前不得連接**。
4. 獨立以核准的隔離 D1 實測 durable inbox first claim、交易 CAS、退款版本 floor、Auth revoke、Queue ACK-after-commit、P05 簽署以及 nonrollback witness；若出現斷線/重播/部分 rollback 不得 ACK、不得授權付費權益。

正式 G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false；#171 是離線整合，不是 Store/Cloudflare 上線。#164 Cloudflare Preview Build FAILED，不得為本 PR Push 受監視分支或修改 Trigger。保留中央 Auth/Battery/Billing 資料庫和原始 Owner 程式；不合併、不部署、不啟用付費。Rollback 只需關閉 Draft PR。