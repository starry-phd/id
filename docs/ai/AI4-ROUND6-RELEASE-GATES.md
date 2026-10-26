# AI-4 Round 6｜AI-0 人工 Release Gate 前置清單（**全部未授權**）

來源：AI-0 第五輪 Draft #52 `b4e34c4dc1fc9425e8c2730e7d2421fcbb87d4f0`，DEV-G API 盤點 Draft #53 `a3c68581bd50ef333bee72ee787717eff5d2af78`，Issue #5 第六輪指示。此檔為 GitHub 版本化工作檢查表，不構成部署工作或驗收成功證據。

## 對應 Owner／契約
- **AI-0**：逐條核准 Gate0 來源需求、P05 正式 canonical event、11 release Gate（G00–G10），給出每項人員簽核與 rollback go/no-go；目前一律 BLOCKED。
- **AI-4 DEV-G（目前仍兼任）**：公開 API 只有 `GET /v1/health`；版本 `0.1.0`，所有其他 Member、Billing、Admin/跨品牌 API 僅 Draft/disabled；typed public SDK 只輸出 health + disabled sync。新 HTTP surface 或 SDK breaking change 需版本化 proposal、SDK diff、四端消費者影響、AI-0 安全 Gate 再開啟。`apps/api/contracts/round6-release-guard.json` 與 CI 能拒絕誤發布（防護不等於發布授權）。
- **AI-1**：官方 Apple/Google OIDC trust/JWKS、backend Session、CSRF/nonce/S256 PKCE、真 D1 migration/rollback、保護 cookie 與實機。
- **AI-2**：Apple official x5c root+OCSP/Workers 相容；Google Pub/Sub/Play official bearer/JWKS、sandbox entitlement、refund/chargeback；不得用 test-only fake snapshot 當驗單。
- **AI-3**：真實 D1/Queues durable receipt、DLQ、原子 claim+append、source lag retry，不可過早 ACK/quarantine。
- **AI-4 DEV-I**：Staging Cloudflare 隔離/最小權限/備份/回滾與可追溯 SHA/CI/成本；DEV-I 預設 EAS Free，**每 PR 只跑必要 CI**，不每 PR EAS 原生 Build/Update/Workflows。

## 未獲准前必要 Gate 與手動檢驗順序
1. AI-0 核准正式需求版本、身份／權益／事件授權、P05 發行與演練範圍。
2. 核准測試帳號、官方 provider trust、Environment/bundle/package/SKU、Cloudflare D1/Queues、保管 secrets 的負責者與 Least Privilege；確認不接真正式資料。
3. 在獨立 Staging 的驗證計畫中測 OAuth callback／吊銷、CSRF/PKCE、session key rotation、StoreKit/TestFlight、Play Internal／RTDN、Queue crash/retry/DLQ、D1 restore/rollback。**目前完全未執行。**
4. Web/PWA 和 iOS/Android **實機**必要：Apple/Google Auth、IAP、推播、deep link、runtimeVersion 相容、審核/上架；不得以純 Node/SQLite dry-run 取代。
5. 記錄環境 ID、受控 GitHub SHA、workflow/job、API spec/SDK version、reversible migration、快照與核准人、API error 401/403/409/429/5xx、P95、成本，方可由 AI-0 提出下一道 Gate。
6. 任何失敗先 fail closed、停用敏感入口、保全已提交 outbox/audit、評估 replay/恢復，無批准不得啟動回滾操作。

## DEV-G 未來增設 AI-5（**未批准／未啟動**）
如業主日後單獨同意 AI-5，僅建議接管 OpenAPI/SDK version governance、介面消費者與變更評估、文檔管理；**現在 Owner=AI-4**。不移交 AI-1 身份真相、AI-2 Billing 交易/Store 驗證、AI-3 Audit/Queue atomic writer，且任何轉移需新 owner matrix+API Gate。沒有新組織帳號、付費、合併或部署。

**Boundary：** 未操作 Cloudflare Preview/Staging/Production、D1、Queue、EAS Build/Update/Workflows、Secrets、Store、正式會員資料；H-Global 完全獨立、暫停；Starry Battery 永久免費。
