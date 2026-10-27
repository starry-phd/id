# AI-0｜GitHub Draft PR 相依鏈與 R12 前置稽核（2026-10-27）

> **核對狀態：AI-0 R7→R11 的九份 PR metadata 歷史快照；不是 GitHub 的持續監聽，也不是 main/Production 已含此程式的證據。**
> 這份工作不動目前 AI-1～AI-4 R12 Owner 程式，不做 merge、rebase、squash、cherry-pick、force push 或部署。任何未來正式整合必須重新讀最新 GitHub PR／SHA 和分支。

## 觀察到的風險與明確界線

2026-10-27 向 GitHub 查詢時，以下**九個 AI-0 相依 PR 皆為 Open/Draft/Not merged**；其 PR 的 base branch 依序是上一個 PR 的 head branch，最後到 [R11 #88](https://github.com/starry-phd/id/pull/88)。這是**分層 Draft 的開發鏈**，不等於九個 PR 已合併 main；反過來也**不能**單憑 PR 狀態判斷 main 是否以其他方式含有相同程式，須另外做真正 Git commit ancestry/diff 驗證。

| 層 | PR | 用途 | 此快照的 base |
| --- | --- | --- | --- |
| 1 | [#64](https://github.com/starry-phd/id/pull/64) | R7 四 Owner 整合 | R6 四 Owner 基座，**本稽核未追查更早祖先** |
| 2 | [#65](https://github.com/starry-phd/id/pull/65) | R8 128-source trace | #64 head |
| 3 | [#70](https://github.com/starry-phd/id/pull/70) | GitHub CI/SOP 最佳化 | #65 head |
| 4 | [#71](https://github.com/starry-phd/id/pull/71) | R8 四組整合 | #70 head |
| 5 | [#76](https://github.com/starry-phd/id/pull/76) | R9 四組整合 | #71 head |
| 6 | [#80](https://github.com/starry-phd/id/pull/80) | R10 非 Owner 規劃 | #76 head |
| 7 | [#82](https://github.com/starry-phd/id/pull/82) | R10 四組整合 | #80 head |
| 8 | [#87](https://github.com/starry-phd/id/pull/87) | R11 ADR／風險前置 | #82 head |
| 9 | [#88](https://github.com/starry-phd/id/pull/88) | R11 四組整合 | #87 head |

固定 HEAD、完整 base/head 字串、各 PR 的 Draft/Merged 快照在 [JSON](./ai0-pr-stack-snapshot-r11.json)。#88 此次最後驗收 SHA 為 `fa85b9ad9a2354ed4e9a19538c269cf232c803eb`。[Issue #1 最終 R11 驗收](https://github.com/starry-phd/id/issues/1#issuecomment-6437271393) 記錄離線 CI 3/3 成功；不代表全部祖先已完成正式合併審查。**R12 Owner PR 在此快照範圍外，因正在執行，不能假設它們已完成。**

## 已新增的實際防錯程式

- [`audit-ai0-pr-stack.mjs`](./audit-ai0-pr-stack.mjs) 是**無任何網路呼叫、唯讀**的 GitHub PR 快照與正式 Release Gate 檢查器。當下使用上一回由 AI-0 實際核實的快照，不會自動查 GitHub 最新 PR，因此標為 **historical snapshot audit**。
- [`ai0-pr-stack-audit.test.mjs`](../../packages/integration/test/ai0-pr-stack-audit.test.mjs) 由已存在的 AI-0 最新 full offline CI `packages/integration/test/*.test.mjs` 路徑自動執行。正向驗證九層 Draft／Gate；負向驗證錯誤基底、重複 SHA、意外 merged、直接指向 main、錯誤最新整合 SHA、Gate 意外解鎖、自動部署誤開。**不增加 GitHub Actions workflow、Runner 排程或付費。**

本地可執行（Node 22，僅讀此 checkout）：

```sh
node docs/operations/audit-ai0-pr-stack.mjs
node --test packages/integration/test/ai0-pr-stack-audit.test.mjs
```

> **重要：** checker 執行成功只代表「**已記錄的 2026-10-27 JSON 快照與安全文件內部一致**」，**不能**宣稱當下 GitHub PR 最新 HEAD 沒變、沒有錯誤合併、main 的 branch protection 已查過，或已取得 Release/Staging 授權。真正版本核對仍必須向 GitHub 重讀。

## 下次 R12 真四組整合的安全順序

1. 重新讀取 GitHub Issue #1、各 Owner Issue、最新 AI-0 已驗整合 PR 及基準 SHA；不要用本 JSON 快照代替 GitHub 的最新資料。
2. 對四位 R12 PR 分別取得**最新 PR HEAD、base SHA、變更檔清單、來源 Git blob SHA**及該**同 SHA** Actions。若有 pending/failed、PR base 不是正確 R11、相同路徑衝突或檔案越權，先確實核對／處理；不猜測或忽略。
3. 以驗證過的最新 AI-0 base 建立**新的獨立 Draft 分支**，一次 Git Tree 整合真正 Owner files（不是只抄 PR 摘要），不得擅改其他 Owner 內容；AI-0 新增的跨組安全測試需同 checkout 引入四組真正模組。
4. 新 PR 完成後**只看新固定 HEAD** 的 Actions，完整 `completed/success` 才可標離線驗收完成；正式 G00～G10 11/11 blocked 保持原樣。
5. 新總驗收才能編輯／新增更新版快照；本 R11 快照保留歷史，不在四位 R12 工作途中覆寫或挪用其進度。

## 將來真的準備納入 main 時（**本次絕不執行**）

- 必須先由業主明確授權，且 Gate/憑證/成本/法遵合規已達對應審核；Review 戰術不能繞過正式 Release Gate。
- 對完整 Git 歷史做**真祖先比較**：從 #64 以前的 R6 基座到最後整合 HEAD 的所有修改與範圍；比對 main 實際是否早已含等價 commit，避免 duplicate cherry-pick 或覆寫修復。
- 逐條審核 Owner PR 與 AI-0 變更（尤其 source 128 heading 只代表追溯結構，非全部需求完成；#70 optimized CI 本身仍在 Draft）。
- 規劃分層逐 PR 合併、或在合法授權之後用新的明確整合候選，**都需要全量測試與保護檢查**，不可因下層已綠就跳過上層審核。不要自動將 #88 的 staged integration 當作已正式發布。
- **H-Global** 仍不與 Starry 共用正式 DB/Secrets/Auth/管理員或金流，也不在本次恢復任何工程。

**安全結論**：11/11 Release Gate 仍 BLOCKED，`PUBLISHABLE=false`；沒有 main merge、Preview/Staging/Production、真 D1/R2/Queue/Store/OAuth/EAS/Secrets、任何付費操作。這份稽核為後續 AI-0「省時間且減少版本混亂」建立可重複使用的可測基礎。
