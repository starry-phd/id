# AI-4 Round5｜離線端對端整合與 AI-0 Gate

**來源**：AI-0 第四輪合流 Draft PR #46 固定 SHA `bacc0166bf4e1070a4696c7bc109197b4c642f9f`；已收 AI-1 #41、AI-2 #44、AI-3 #45、AI-4 #42 與 AI-0 P05 #43。仍屬離線候選，未合併 main 或部署。

## 確實可執行的驗證
- `apps/api/test-support/round5-vertical.ts` **測試支援模組，非 Worker 實際入口**：AI-1 真 WebCrypto session 驗簽 + prepared Starry D1 Port + current status/version/provider stable subject → canonical WeakSet Principal → protected Member contract → SDK。
- 同一 Principal 經 AI-2 `planSandboxPurchase`，帳號綁定從 Starry ID-owned D1 port 讀取，而非 HTTP claim；再由 AI-2 `createSandboxBillingD1Writer` 以五條 D1-shaped batch 模擬唯一領域提交；**唯一**讀取來源為 AI-2 `readAfterCommit`。
- AI-0 `packages/ai0-contracts` 提供 `billing.p05.v1-candidate` 13 欄候選驗證端，透過測試限定 server-injected Gate；AI-3 真 `createRound4BillingAuditConsumer` + `createAi3AuditD1Store` 作 inbox/audit 四條 D1-shaped batch、quarantine/readback；AI-3 `dispatchQueueMessage` 接 AI-4 未部署 Queue 執行器，ACK 僅在 durable Receipt 之後。No global production P05 authorization.
- 測試覆蓋 Session 簽章遭竄改、停權/撤銷/版本更動、錯 store binding、Batch rollback、缺失 committed event、AI-0 版本 Gate 拒絕、冪等 duplicate/異 digest、inbox 寫入失敗的 retry、DLQ 持久失敗不可 ACK、偽造 message DTO。
- 測試使用每次產生的不可匯出 HMAC key、手工 D1-shaped 完全離線模擬、假 Store snapshot；**不是真 Cloudflare D1 的批次交易實測，也不是真 Apple/Google 官方 Sandbox 驗證，不證明跨庫 exactly once**。
- 所有 AI-1/2/3 和 AI-0 的原始領域程式皆保持不修改；根 Node、各領域 TS/Node/SQLite、Expo 配置與 Wrangler **dry-run** 在相同 Commit 的 GitHub Actions 驗證。

## Staging／EAS 前的 AI-0 必要批准
1. **Gate0**：完整 108+P10+N10 規格審核，目前 25 seed/128 source headings 不代表已核准。
2. **Auth**：Apple/Google callback HTTPS domain、固定 issuer/client/audience JWKS/PKCE、state+nonce+one-use D1 CAS、Session key rotation、cookie origin/CSRF、D1 migrations/backups與跨 Worker 競爭/撤銷機制。
3. **Billing**：Apple x5c/PKI 官方 trust root/撤銷、Google official PubSub JWT/JWKS 與 authenticated subscriptionsv2 API、sandbox Storekit/Play 實機端對端、業主核准 SKU/訂閱業務、Billing D1 transaction+快照/restore。Starry Battery 永久免費；無 H-Global。
4. **Audit/Queue**：AI-0 正式唯一 P05 version、AI-2 committed read、AI-3 inbox+append+quarantine 單 D1 原子 readback、Queue durable DLQ/重送/人工作業、權限最小化／回滾；禁止未授權發布。
5. **Ops**：Cloudflare staging 與 production 嚴格隔離、Secrets/key rotation、CORS/CDN allowlist、API 監控／錯誤率／成本／回退與 P09 GitHub SHA/CI/環境/部署來源。
6. **DEV-I 2026-10-26 八項最終規則**：EAS Free 為預設；每 PR 必須跑必要 TS/Lint/API/security CI，但**不得每 PR 自動 EAS Build／Update／Workflows**。原生 SDK、Auth、IAP、通知及上架之前，不能省去 iOS/Android 實機、TestFlight／Google Play internal 與相容 runtimeVersion 測試。EAS Build/Update/Workflows 額度分開追蹤、不得自行付費升級。
7. **未獲准前**：不合併 main、不啟用正式 Worker 的 Member/Billing/Queue route、不接真 D1／商店／Secrets、不執行 EAS／部署／付費服務。真 Worker `apps/api/src/index.ts` 仍僅 `GET /v1/health`，Expo 會員登入仍 disabled。

AI-0 審核標準：此單一 snapshot 的 PR/Commit/CI 與此文件之證據，而非「module exists = 上線」。
