# AI-0 第六輪離線整合 Gate｜2026-10-26（部分交件，待 AI-1）
**Release BLOCKED／本 PR 僅為新一輪離線整合候選，不是 main merge、Cloudflare 部署或上架授權。**

## GitHub 權威來源與基線
- 本輪基於已驗證的 AI-0 第五輪 [Draft #52](https://github.com/starry-phd/id/pull/52) HEAD `b4e34c4dc1fc9425e8c2730e7d2421fcbb87d4f0`。
- 包含堆疊的 AI-0 DEV-G [Draft #53](https://github.com/starry-phd/id/pull/53) HEAD `a3c68581bd50ef333bee72ee787717eff5d2af78`；它不是新 AI-5 任命。
- 包含 AI-4 第六輪 [Draft #54](https://github.com/starry-phd/id/pull/54) HEAD `3b9391636b6576f636c331bfcdbdae645680796e`（已經以此固定提交作為新 AI-0 分支祖先）。
- 包含 AI-2 第六輪 [Draft #55](https://github.com/starry-phd/id/pull/55) HEAD `966d89274cb4655e4ffa69f30e881bd3e27a1a55`：固定 2 檔。
- 包含 AI-3 第六輪 [Draft #56](https://github.com/starry-phd/id/pull/56) HEAD `acaad9f91dc560d38d5b17fcab6cf85e37f97af7`：固定 6 檔。
- AI-1 第六輪 **截至建立此整合候選時尚無新的 GitHub PR／交接 SHA**，僅上一輪 #49 已包含在 #52；不可宣稱第六輪四組整合已全部完成。待 AI-1 提供其最新 Draft 與 CI 再同 Checkout 驗證後才可作完整第六輪判決。

## 安全契約與測試重點
1. AI-2 實際後端 Billing committed source 為 `null` 時重試；attempt 1～4 無 ACK、無預先 quarantine；attempt >=5 只有 durable DLQ 寫入與匹配回執成功後才可 ACK。
2. AI-3 對超過 5 次 delivery 使用 `min(actualAttempts,5)` 作安全領域判斷；持久記錄保留真實次數；無效 attempt、revoked Proxy、隱藏 getter 與偽造來源拒絕。
3. AI-4 以同一 checkout 測試 missing source → 之後權威 commit → inbox+audit → ACK，且 guard 阻止尚未核准 API/SDK、P05、AI-5、EAS/雲端服務被意外公開。
4. G00～G10 **11/11 BLOCKED**。P05 `billing.p05.v1-candidate` 仍 `PUBLISHABLE=false`，Cloudflare Workers 正式公開路由源碼僅健康檢查；Node/SQLite mock 不是 Apple/Google 官方登入/驗單，亦不是正式 Cloudflare D1/Queues/Worker/Staging 的通過證據。
5. 不沿用 H-Global 資源；Starry Battery 永久免費且不得透過 Billing 購買。遵守 DEV-I EAS Free 及使用者事前批准付費原則。

## 驗收分級
- Owner 各自 PR CI：已在 #54/#55/#56 按固定 SHA 獨立驗證，**不能**代替本整合分支的同一 SHA CI。
- AI-0 新增 `.github/workflows/ai0-round6-union.yml`：只執行 read-only npm、嚴格 TypeScript、Node、SQLite :memory:、SSOT、11-gate fail-closed、OpenAPI/SDK 暴露清單、Expo config 和 Workers dry-run；**沒有 EAS Build/Update、Cloudflare Deploy、Secrets、D1 migrations、真付款或付費任務**。CI 結論以 GitHub run 真實結果再更新，不可預先宣稱 PASS。
- 真實雲端／原生設備 Gate：G00 核准產品需求、官方 OAuth/PKI、Store Sandbox、真 D1/Queues/DLQ、EAS 原生測試、備份與成本需另由業主批准範圍與驗收。不授權任何合併、環境變更。

**Next:** 檢查此 Draft 最新 HEAD／Actions；若發現跨組型別或語意衝突，先修安全測試或回報 Owner，不可以減少負測換取 CI 綠燈。收到 AI-1 R6 新 SHA 再補齊四組整合。