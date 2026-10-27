# AI-0｜R12 四 Owner exact-blob 整合 × R12 PR 版本鏈稽核（2026-10-27）

> **狀態：隔離 Draft 整合候選，必須依本 PR 最新 HEAD 的 GitHub Actions 完整驗證，才能稱 R12 離線總整合通過。不得因各 Owner 不同 SHA CI 過關就假定同 checkout。**
>
> 基準為 [AI-0 R12 平行 PR 相依鏈稽核 #93](https://github.com/starry-phd/id/pull/93) `78c6cc52556fb13e268f01e76419579f50835243`；其祖先為已驗 [AI-0 R11 整合 #88](https://github.com/starry-phd/id/pull/88) `fa85b9ad9a2354ed4e9a19538c269cf232c803eb`。#93 的 9 層歷史 PR 快照、無網路稽核工具及 CI 8 項正負測原樣保留。

## 四位已交付之真實程式來源（固定 Git Source Blob SHA）
| 專責 | 最新 Draft PR／固定 SHA | 直接匯入檔案 | R12 真正新增內容（仍離線，未啟用） |
| --- | --- | --- | --- |
| AI-1 Auth | [#90](https://github.com/starry-phd/id/pull/90) `0a00785830e36777c8710a19886177aa7b2c7552` | **3 檔** | WebCrypto RSA 簽章**獨立 Auth Head 第二鑰**與 R10/R11 身份復原證據防重播；沒有真不可回退服務 |
| AI-2 Billing | [#91](https://github.com/starry-phd/id/pull/91) `554697392eff0046595412d69797aa8dac402054` | **3 檔** | RS256 Billing outbox 事件 witness 驗簽、受保護最新 Head 與退款防重播，Store/D1 仍候選 |
| AI-3 Audit | [#92](https://github.com/starry-phd/id/pull/92) `fc1cf4df2ac56e509ca8660a3f8d7674f22d61e7` | **5 檔** | 獨立 Audit 事件高水位 RSA 逐筆驗簽、法定保留／還原反復活及 SQLite memory 失敗情境 |
| AI-4 Task | [#89](https://github.com/starry-phd/id/pull/89) `9e530610291be1cf0858680856aa9773c6ffaf59` | **4 檔** | Task committed proof RS256 驗簽、獨立 anti-replay Head 和時間窗檢查，沒有真 Task issuer |

本輪 **15 個來源原始 Git Blob 完全原樣、無重複路徑、跨 owner 不互改**；AI-0 新增 **2 檔**：`packages/integration/test/round12-all-owners-gate.test.mjs` 與本文件。透過一次 Git Tree → 一個 Git Commit 完成 **17 檔**。保留前輪 #87 的跨 D1 ADR、安全 Staging 計畫與風險 JSON，及 #93 的 PR 相依快照；**未重做或覆蓋**。

## Owner R12 原 SHA 各自 CI 證據（不是本整合的替代）
- AI-1 #90：2/2 workflows `completed/success`。
- AI-2 #91：2/2 workflows `completed/success`。
- AI-3 #92：1/1 full offline workflow `completed/success`；外部 Cloudflare Workers Builds 不能從 GitHub offline CI 推定成功。
- AI-4 #89：1/1 full offline workflow `completed/success`。

## 新整合的同版驗收條件
- 在**同一 HEAD** 下執行 Node22 locked deps、TypeScript、Lint、SSOT/128 來源結構、Release `--assert-blocked`、Expo config、Wrangler **dry-run**、所有 AI1/2/3/4 實際 Node 與 SQLite in-memory 正負測。
- 新 R12 integration test 必須 import 四位 R12 真實模組、R11 的 Restore/Task/Wallet/Reconciliation/Release 旗標，確保默認禁止真線上執行及 7 個恢復域完整。
- R12 各自 RS256 **本機驗簽通過**不等於具備真正密鑰發行管理、獨立不能回退的 Anchor，不能視為「真正 Auth、Billing、Audit、Task 系統」已通過真實 Cloudflare/OIDC/Store/Queues/PITR/EAS。
- **只有本整合 PR 最終 SHA 全部 GitHub Actions completed/success，才可標記 `R12_OFFLINE_SAME_CHECKOUT_VERIFIED`**。

## Release Gate 與後續仍需業主裁決
- [跨 D1 一致性 ADR](../adr/AI0-R11-CROSS-D1-CONSISTENCY-20261027.md) 仍在研究「同一 Starry 交易權威」或「持久 Outbox/Saga」，**未有正式裁決**；AI-3 單 DB batch 不是跨多 D1 事務。
- Q104/Q119 合法刪帳／去重保留、免費 Battery X/Y/各 task 費率／欠額限額仍未核准。雙品牌管理／Auth／DB/Secrets/Store 隔離；H-Global 工程暫停。
- 真獨立 RSA witness 簽發/輪換/KMS、Cloudflare R2/D1/Queues、P05 schema、Apple/Google Store OAuth/SKU、第一款 consumer App、EAS 原生裝置、費用與風險演練皆待另行受控 Gate。
- **G00～G10 正式 11/11 BLOCKED；`PUBLISHABLE=false`。禁止自行合併 main、部署 Cloudflare Preview/Staging/Production、操作真 D1/R2/Queue/Store/OAuth/Secrets/EAS 或產生付費。**
