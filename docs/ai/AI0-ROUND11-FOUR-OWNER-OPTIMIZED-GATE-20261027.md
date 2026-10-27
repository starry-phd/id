# AI-0｜R11 四位 Owner 實際程式 + AI-0 平行架構規劃：單一 checkout 驗收（2026-10-27）

> **文件屬安全 Draft，最新 GitHub Actions 必須以此整合 PR 的最終 HEAD 獨立查證。** 來源 Owner PR 綠燈不代表跨四組單一 checkout 已通過。正式 G00–G10 11/11 BLOCKED，無 main merge／真環境部署／付費。
>
> Base：[AI-0 R11 PREP #87](https://github.com/starry-phd/id/pull/87) fixed `54bf14bdc9dfc5dd9b3806f3c88fd767585b9098`；繼承已驗 [R10 四組整合 #82](https://github.com/starry-phd/id/pull/82) fixed `f1eb5f0655cfdf8c9648ff6d004deed980fbc5d7`。保留 #87 的 ADR、Staging 清單、風險 JSON、離線安全測試，原樣不動。

## R11 四組固定來源（逐個確認最終 Git Blob SHA）

| Owner | Draft PR／固定 HEAD | 匯入原始檔 | 本輪新實作 |
| --- | --- | --- | --- |
| AI-1 | [#84](https://github.com/starry-phd/id/pull/84) `96862073c11227918f2f11417aaf65203e7a9b2a` | 4 | RS256 實際 WebCrypto 簽章驗證和 Auth 獨立見證最新 sequence 高水位防重播；**仍沒有真正不可回退獨立權威服務** |
| AI-2 | [#85](https://github.com/starry-phd/id/pull/85) `7712c546c46ca373d6dca1f655087d4cc68b0ebf` | 4 | Billing outbox 的逐筆退款／事件完整性、獨立 witness 介面和離線 SQLite 高水位審閱；**不是官方 Apple/Play／真 D1 恢復** |
| AI-3 | [#86](https://github.com/starry-phd/id/pull/86) `a13975799b1ec36d63544cb050237456e7dec8c7` | 4 | 免費 Battery Wallet/Hold/Journal 當下、PITR、獨立備份的逐筆比對與防復活；**始終 review_only、may_restore=false** |
| AI-4 | [#83](https://github.com/starry-phd/id/pull/83) `6f73ccc68a63258cf8cf6358e4555a6bee9dc836` | 4 | 已提交 Task → Battery 的 ACK-after-durable evidence／Queue 重試、DLQ 憑證負測；**不是真實 Cloudflare Queue／Worker** |

共 **16 個直接來源原始檔案**，沒有更動 Owner 原內容，也沒有 Owner 間同路徑衝突；本 AI-0 新增 **2 檔**：`packages/integration/test/round11-all-owners-gate.test.mjs`（直接 import 4 個 Owner R11 模組 + R10 關鍵旗標的安全測試）及本固定 SHA 來源/阻塞文件。**單一 Git Tree → 單 Commit，僅 Draft PR**。

## 原始 Owner 的真實離線 CI（非本整合判定）

- AI-1 #84：AI-1 [#40473220177](https://github.com/starry-phd/id/actions/runs/40473220177) + full [#40473220173](https://github.com/starry-phd/id/actions/runs/40473220173) = 2/2 SUCCESS。
- AI-2 #85：Billing [#40473098405](https://github.com/starry-phd/id/actions/runs/40473098405) + full [#40473098445](https://github.com/starry-phd/id/actions/runs/40473098445) = 2/2 SUCCESS。
- AI-3 #86：full [#40473146151](https://github.com/starry-phd/id/actions/runs/40473146151) 1/1 SUCCESS；外部 Cloudflare Workers Builds 曾 FAIL，**不可宣稱 Cloudflare build 或部署已成功**。
- AI-4 #83：full [#40472914440](https://github.com/starry-phd/id/actions/runs/40472914440) 1/1 SUCCESS。

## 同版本測試原則

- 由優化後 [AI-0 最新 Full Offline Gate](../operations/CI-CONSOLIDATION-20261027.md) 重新檢查 R11 16 Blob 及 #87 prep、完整 Node／TypeScript/Lint／Expo config／Workers dry-run／SQLite memory、128 來源結構、正式 Release 11 Gate assert-blocked。
- 新增的直接 import 負測僅證明 **R11 source code 四組同 checkout 的安全關閉旗標**；跨 D1 原子／真官方身分、Store PKI、Queue、簽章 Anchor／PITR 及費用，並未驗證。
- 必須取得本整合最終 SHA 全部觸發 Actions 的 `completed/success`，才能寫 `R11_OFFLINE_SAME_CHECKOUT_VERIFIED`。過去上游不同版本的 Actions 成功不替代。
- AI-0 ADR [跨庫事務選項](../adr/AI0-R11-CROSS-D1-CONSISTENCY-20261027.md) 尚待審核；這份工作**沒有偷偷選擇單庫或 Saga／Outbox 方案**。

## 無法自行解除的 Gate

- Q104/Q119 合法撤回、去重資料保留、真當下會員刪帳 Session/AuthVersion；一個 Wallet `D1.batch` 不可能涵蓋不同 Auth／Task D1 的全部原子性。
- Auth RS256 候選驗證 ≠ 真的站外不可回退 Witness、密鑰輪換、實際權威記錄；Wallet/Task/outbox 的 SHA 一致 ≠ 獨立簽章權威。
- Queue ACK-after-commit／DLQ 是離線 port 模擬，尚缺真正 Cloudflare Durable Resource/D1/Queue 測試及批准。P05 event schema 仍候選、Billing Store 仍 sandbox/mock。
- 第一款正式 Starry 消費 App、Apple/Play 會員真 OIDC、SKU、Battery X/Y／費率及欠額上限、業主成本與分隔 Staging 資源、EAS 真實上架未核准。
- **11/11 Release G00–G10 BLOCKED，`PUBLISHABLE=false`；禁止 main merge、Cloudflare Preview/Staging/Production、真 Secrets/DB/Queues/OAuth/Store、EAS、付款或 H-Global 開發**。
