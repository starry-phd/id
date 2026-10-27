# AI-0｜R9 四 Owner 已交付程式 × 同一 SHA 離線整合紀錄（2026-10-27）

> **狀態：本文件為整合候選，CI 尚待此新 PR 最終 SHA 確認。所有正式 G00～G10 仍 11/11 BLOCKED；未合併 main、未部署或花費。**

## 固定基準與最小更動
- 本輪基準：[R8 AI-0 Verified same-checkout Draft #71](https://github.com/starry-phd/id/pull/71)，固定 `e130bfde68ef0fa40c628a24ec0abade0611d68f`。含 [CI 優化／AI 開發 SOP #70](https://github.com/starry-phd/id/pull/70)。本輪使用 Git Tree Blob SHA 一次匯入多個 Owner 的實際檔案，**單次 Commit**，不從舊 base 重作。
- AI-4 [R9 Draft #72](https://github.com/starry-phd/id/pull/72) `1e63741a14bbef7ccf4ed94feff7128d80b75f61`：**4 個檔**，Server-only AI Task→免費 Battery atomic settlement / Wallet/Task/policy CAS candidate，需當下合法 active Member；真 D1 transaction 和身份權威尚待 Gate。
- AI-1 [R9 Draft #73](https://github.com/starry-phd/id/pull/73) `16b2788bb07e46d7cfb9396f0dd279f8f701ed2c`：**6 個檔**，匿名申訴受保護 reviewer 的 step-up、審計、privacy authority ports，必須 fail-closed，非公開資料 API。
- AI-3 [R9 Draft #74](https://github.com/starry-phd/id/pull/74) `fd453bae6f2a97f9e25607118b91730a4ac40fc0`：**5 個功能／測試檔**，D1 PITR＋獨立備份的 isolated restore review，7-domain anti-resurrection high-watermark fences。第六檔 `.github/workflows/rebuild-ai3.yml` 是舊 branch-filter 異動，**刻意排除**，不覆寫 #70 已加的 concurrency 最佳化。
- AI-2 [R9 Draft #75](https://github.com/starry-phd/id/pull/75) `4e506b6e758ae8eedb51a5924c5e082a2b3adb34`：**3 個檔**，Q113 對帳 D1-shaped prepared lease / CAS、server-only 256-bit nonce、review-only、不可發佈付費權益。
- 總計 **18 個原 Owner 來源 blob** 全部用其 PR 最終 Head 對應 SHA 直接納入、不變更其原始碼，另新增 AI-0 `packages/integration/test/round9-all-owners-gate.test.mjs` 與本核對文件共兩檔。

## AI-0 全域安全檢查
- 最新 R9 交叉測試需在**相同 checkout** 真正 import 四組模組，確保 `RECONCILIATION_D1_PUBLISHABLE=false`、`LIVE_RECOVERY_ENABLED=false`、`RESTORE_MUTATION_ALLOWED=false`、`ATOMIC_TASK_SETTLEMENT_LIVE=false`、`LIVE_BATTERY_WRITES_ENABLED=false`、`RELEASE_AUTHORIZED=false`、匿名申訴仍關閉。
- 直接反測 client JSON 不能偽造 AI-1 sealed reviewer receipt，以及 AI-3 七個反復活 Gate 涵蓋 Auth刪帳／Sessions／首次電池贈送／Battery／AI tasks／Billing outbox／Audit。
- 用已優化的 [AI-0 最新完整離線 Gate](../operations/CI-CONSOLIDATION-20261027.md)：Node22/npm ci、SSOT/R8 原始 128 來源映射結構、Release preflight `--assert-blocked`、TS/lint、Expo、Wrangler **dry-run**、Node 原生負測／SQLite memory，禁止部署/Secrets/付費。各 Owner PR 原 SHA 綠燈**不等於**本整合 SHA 的 Gate 成功。

## 原始各組既有 CI（僅上游交付證據）
- AI-4 #72：完整同版 offline Gate SUCCESS。
- AI-1 #73：AI-1 + 完整同版 offline Gate SUCCESS。
- AI-3 #74：AI-3 + 完整同版 offline Gate SUCCESS；外部 Cloudflare Workers Builds 故障仍不得稱 Preview 已成功。
- AI-2 #75：AI-2 + 完整同版 offline Gate SUCCESS。

## 仍待正式 Gate
1. Q119 資料主體刪帳、匿名案件／會員法定保留、可信已審 reviewer Step-up／隱私法遵及不可復活 Session 和第一次免費 Battery；
2. 任務成功權威、免費電池 X/Y／費率／欠額上限、跨資料庫原子事務、正式 D1/R2/Queue、PITR 受保護獨立備份完整性與逐筆 fence 驗證；
3. Apple/Google OAuth／IAP 官方真實憑證／商店對帳、Paid entitlement/Store 規範及風險／安全／費用；
4. 原生 App EAS/實機/商店驗收、第一個正式產品／SKU/上市市場、真 staging/release Gate。
   
**嚴禁未經另行授權 main merge、Cloudflare Preview/Staging/Production deploy、真 D1/R2/Queue/Secrets、EAS Build/Update、Store/付費或 H-Global 工程。**
