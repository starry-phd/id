# AI-2｜Wave1 Round-002 Server Signed Auth → Billing Review Bridge（2026-10-28）

**此輪完成真 AI-1 Signed Session/D1 Read→AI-2 Billing *離線審閱* 接線，不是 RevenueCat 或 Store 正式權威。** 基準 AI-0 [四 Owner 同版 Draft #191](https://github.com/starry-phd/id/pull/191) SHA `84a23e6ed31fd5a91675ac46b3ab012d01567df6`、[Gate2 offline success / Gate1+3 blocked](https://github.com/starry-phd/id/issues/1#issuecomment-6467052301)、[本組 Round-002 派工](https://github.com/starry-phd/id/issues/3#issuecomment-6467063140)。

本輪新增 `src/wave1-r002-signed-auth-billing-bridge.ts`，**直接 import AI-1 既有** `createOfflineStarryPurchaseEntryGate` 與 **AI-2 R001 既有** `createOfflineWave1BillingPolicy`，不重寫 Auth 或商品規則。呼叫 AI-1 真 WebCrypto HMAC signed Bearer 與原 Auth SQLite D1 Member/Session/provider 身分驗證，三次重新讀取，第一次、第二次比較同 app_id / brand / env / user / session_id / auth_version，AI-2 審閱事件後第三次再次驗 Session；撤銷、刪除、切換帳號／Session 或 auth_version 變動 fail closed。僅 DEV/STAGING，`enabled` 預設 OFF。從**經 AI-1 server-only WeakMap proof** 取出短效 ServerIdentity，使用提供的 **合成測試用 HMAC** 進行 `starry-billing-r002|app|env|user` 分域單向 member_digest；絕不把 raw Starry ID／session／member_digest 暴露給客戶端或放到 DTO，不能使用使用者輸入 `member_digest` 當已驗權。

**不可混淆的權威層次：** 通過簽章只證明本機注入簽名 key＋SQLite 測試環境的伺服器 Session 讀取，不等於真 Cloudflare/KMS/JWKS、合法身份映射、RevenueCat 客戶身分、Apple/Google 官方 Store transaction/entitlement 或可部署權限。回傳有 `candidate`，只沿用 R001 `review_only`，**所有 can_start_purchase / restore / grant / remove_ads / ack_webhook / publish / live 永久 false**；Q1 same App 跨 iOS/Android 有效內容權益是正式產品方向，**沒有跨 Store 交易轉移或 Sandbox 合規證據**。退款／撤銷／訂閱到期不解除仍有效的非消耗型買斷候選。各 App 所有 SKU/權益和 HMAC digest 分域，禁止 Battery/消耗性商品，廣告 OFF。

## 驗證／依賴
- Node 22+：`node --experimental-strip-types --test packages/rebuild-billing/test/wave1-r002-signed-auth-billing-bridge.test.mjs`。使用真正 `node:sqlite` `:memory:`、既有 Auth schema、WebCrypto 簽名、原簽名驗證程式及既有 Billing policy；不需 Network/Store/D1/Queue/Secret／新 dependency。
- **AI-1 #2**：需 Gate 1 核准 server-only identity、當前 Session Auth D1 read、HMAC/KMS key 管理／撤權／資料處理 Q104/Q119；本地 `offlineDigestKey` 只是 ephemeral test fixture，不能由 CI 通過變更為 production key。
- **AI-4 #5**：在 AI-0 正式批准後提議受保護內部 Billing route / API error code / AppRegistry SKU，禁止把 `readServerIdentity` 或 key 暴露於 public OpenAPI/SDK。現在沒有新 Worker endpoint。
- **AI-0 #1**：檢查此跨 Owner import 邊界與 body DTO，Gate2 請用新整合 SHA 重跑，不自動將 #191 PASS 改成新回合 PASS。G04/G05/各正式 G00-G10 11/11 BLOCKED，P05/PUBLISHABLE=false，真 Store Sandbox／雙平台退款恢復、Receipt Ownership、RevenueCat App User ID、原生 Build、真 D1 CAS/Queue 恢復仍缺驗收。
- **下一輪 Round-003**：AI-1/AI-0 確定 versioned HMAC / session-on-demand server-only 介面後，AI-2 研究授權內部 RevenueCat ID 對映與 webhook signature 驗證、訂閱/永久產品併存的真 Store Sandbox 驗收矩陣；取得業主單獨明確資源與費用批准後才能做任何真 Google/Apple Store、Cloudflare/EAS／RevenueCat。無其他 App、私有 Monorepo（Q5=B）、Ads、H-Global 或付款。

**Rollback**：關閉本 Draft PR；此分支只有新 AI-2 專責 source/tests/docs，未修改原 AI-1/Billing/central schema、Worker/CI/main、未產生真 Cloudflare/Store 或費用。
