# AI-4 第四輪｜Workers / SDK / Expo / 跨域 Gate + DEV-I EAS Free
基準：[AI-0 第三輪整合 Draft #40](https://github.com/starry-phd/id/pull/40) `6d7c54e8c8eecdde810a83932ac9f6bc6fee53fd`。以此固定 SHA 堆疊獨立 Draft PR；不修改 AI-1 `modules/starry-id-v1/**`、AI-2 `packages/rebuild-billing/**`、AI-3 `packages/rebuild-ai3/**` 或 AI-0 registry/SSOT。

## 真正新增的可執行離線安全切片
- `apps/api/test-support/round4-member-worker.ts`: **真 AI-1 WebCrypto HMAC signed Session verifier** + AI-1 `createStarryD1Port` （以準備語句唯讀 fixture 實作）→ `createServerIdentityResolver` 發出 WeakSet principal → AI-4 Member protected transport → preview typed SDK。正反測試證明真密碼驗簽不足以授權：每 request 必須重新讀 active member、session revocation/version/provider stable-subject，錯 scope/過期/偽造自動拒絕。不存在真 D1 操作、真 Apple/Google OIDC Code Exchange/JWKS；測試金鑰當次不可匯出。
- `apps/api/test-support/round4-queue-runner.ts`: offline Queue message `ack/retry` 介面接 AI-3 **真 `createReliableBillingAuditConsumer`**；來源只能從可信已 commit、provider-verified 的 AI-2 port 和 AI-0 已批准 P05 驗證端產生，否則 retry/quarantine。未實作/未宣稱正式來源信任和 Queue。測試確定 AI-3 inbox+audit 原子回報之前禁止 ACK、相同資料重試 duplicate、不同 digest quarantine、DLQ 無持久回執時不 ACK；**此 Queue Runner 僅 test-support，禁止自動部署**。
- `apps/mobile/src/eas-cost-policy.ts`: DEV-I 2026-10-26 **最終八項**成本規則的純證據／否決 gate；每次 PR 仍應執行免費 CI，而原生 EAS Build／Update／Workflows 預設不執行；必須以實際 Expo 遠端 ID、核准、runtimeVersion、環境與發票來源證明，不以 null 當免費成功；本輪沒有觸發任何 EAS Operation。
- 現有可公開 Worker `apps/api/src/index.ts` **仍僅 `GET /v1/health`**；member API factory / preview SDK / Queue runner 不由正式 Worker export；Expo 會員介面仍 disabled；未開任何帳單或管理 API。

## 進 Staging / 原生測試前的必要安全 Gate（**本輪未批准執行**）
1. AI-0 規格 25 seed / 128 標題逐項審定、P05 canonical 版本/事件白名單、P03/P04 資安角色與 App registry；AI-1 與 AI-2 專責契約版本固定；避免多份可分歧 principal validator。
2. Starry 專屬 Apple/Google callback domain、redirect URI、issuer/aud/client ID、保護 HTTPS JWKS 快取與 rotation/unknown kid、受控 PKCE/state/nonce/single-use D1 CAS、CSRF/重播限制/率限；H-Global 完全隔離。
3. AI-1 Starry D1 專屬 Database binding、migration review、資料備份／rollback、只准領域 writer 對會員資料變更、session/key rotation/revocation D1 一致性。AI-2 官方 Apple x5c PKI 與 Google PubSub/Play Developer API Sandbox 權威驗證、批准 SKU、帳單單庫原子 owner/event/entitlement/outbox。
4. AI-3 P05 canonical event（不能拿候選冒充批准），已提交 Billing outbox 可信 reader、稽核 D1 inbox+audit 原子提交／持久 quarantine、Cloudflare Queues binding/DLQ 成功寫入回執、補償、退費延遲/重播測試；跨庫不宣稱 exactly-once。
5. CORS/CDN origin allowlist、關閉跨品牌登入／廣泛 Cookie、HTTPS、監控與 rollback，公開 OpenAPI 與 SDK 需等 Gate 核准；P09 記錄 GitHub PR/SHA/CI、Cloudflare 部署版本與 EAS build/update ID（缺資料標 unknown 而非假造）。
6. DEV-I EAS Free 成本：每 PR 根 TS/Lint/Node／SQLite／dry-run CI；**不自動 EAS Build**。純 JS 優先重用兼容 runtime 的 Development Build；原生登入／內購／推播要安排必要 iOS/Android EAS 建置、TestFlight / Google Play internal 測試與裝置測試，另經業主批准可能的額度/付費。Build/Update/Workflows 分開計量，Update 要核對 runtimeVersion/環境/channel，絕不拿 OTA 取代原生編譯。

## 仍然 BLOCKED
真實 Cloudflare D1/Queues、Provider OAuth/Store 官方信任、官方 Sandbox 真機交易、原生 EAS 裝置 CI、Staging/Production 域名/Secrets/部署、所有付費皆未發生。以本 Draft SHA 實際 GitHub Actions 結果決定離線驗收，不可宣稱可上線。
