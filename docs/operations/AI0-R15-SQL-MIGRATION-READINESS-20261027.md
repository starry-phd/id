# AI-0｜R15 平行工作：四個隔離資料域 SQL 草稿與回復安全稽核（2026-10-27）

> **狀態：OFFLINE INVENTORY / NOT AUTHORIZED TO MIGRATE**。四位 AI-1～4 正在獨立開發 R15 的 Auth→Billing/Battery deletion-event candidate，不修改他們的程式／分支；本工作專注於 R15 後續準備真正 Cloudflare D1/恢復之前，避免 SQL 草稿被誤視為已部署或具備安全 Rollback。
>
> 固定 SSOT：[R14 AI-0 已驗整合 Draft #106](https://github.com/starry-phd/id/pull/106) HEAD `dbb565895489cbe2a3b78eab7006ef0cdc48f01a`，CI 3/3 成功是**離線**證據。正式 G00～G10 **11/11 BLOCKED**，`PUBLISHABLE=false`；沒有獲准部署、真 D1 Migration、備份復原或費用。

## 已核對實際 SQL 檔案（不是空白規劃）

| 責任領域 | 這個固定 checkout 中實有的 SQL 草稿 | 版本/回退狀態 | 真實門檻 |
| --- | ---: | --- | --- |
| Starry Auth / Member，AI-1 | **20** | `001`～`004` 為獨立 DRAFT；`005`～`012` 有 **8 組 UP/DOWN**（16 檔） | DOWN 檔即使存在也**未**核准用於真 D1；刪帳後反復活保護不能由盲目 DOWN 卸載 |
| Starry Billing / Store，AI-2 | **5** | `0001`、`0004`～`0007` 均為單獨 DRAFT；在此快照沒有編號 `0002`／`0003` | 不擅自認定遺失版本，不補寫編號；須正式 Billing DB 升級/回復與 Store/個資批准 |
| Starry 免費 Battery / Audit，AI-3 | **10** | `0001`～`0010` 單獨 DRAFT；未見同名獨立 DOWN 配對 | 需合法保留／跨 Auth 刪帳 tombstone 及 Queue delivery 的恢復證據，不能宣稱已具可逆回退 |
| Starry Task / Outbox，AI-4 | **1** | `task-commit-outbox.v0.DRAFT.sql`，為**離線 SQLite 契約草稿** | 單 Task DB CAS/outbox 離線原子 ≠ 不同 D1 Wallet 贈送和任務一致提交 |
| **總計** | **36** | **8 組 UP/DOWN + 20 份獨立草稿** | **0 真環境核可／0 已證真 Cloudflare D1 Migration** |

> **檔案計數**是此 Git Tree 在四個具體 schema/contracts 資料夾下的 `.sql`；不是整個雲端帳號的資料庫數或已部署 migration。真 DB、Migration 版本紀錄、可能的遺漏歷史均未從此清單推導。

## 本次已新增、可以真正被 CI 執行的稽核

1. [36 份真來源路徑分類清單](./r15-sql-migration-inventory.v0.json)：每份檔案附 Owner logical domain、standalone 或 UP/DOWN peer、`execution_authorized=false`、`production_rollback_verified=false`，不包含帳號密碼/Secret/個資。
2. [唯讀 SQL 一致性與安全檢查程式](./verify-r15-sql-inventory.mjs)：檢查檔案真實存在/非空、域別歸屬與草稿命名、Auth UP/DOWN 雙向配對、是否多了未核對的新 SQL、正式 11 Gate 仍封鎖；**不連線、執行、套用或復原任何 D1**。
3. [自動 Node 負向測試](../../packages/integration/test/r15-sql-inventory.test.mjs)：故意偽造上線/受控 Staging/合法 rollback 許可、缺 DOWN、虛構 SQL、跨品牌、未列的新 SQL、移除檔案或偷解鎖發佈 Gate，應全數拒絕。透過已優化 GitHub Full Offline Gate 的**現有測試 glob**執行；不新增 workflow 或收費。

本機可用 Node 22 安全只讀檢查：

```sh
node docs/operations/verify-r15-sql-inventory.mjs
node --test packages/integration/test/r15-sql-inventory.test.mjs
```

## 真部署／回退前仍缺的核可證據

- **R15 新 SQL 交付變更**：AI-0 下一次整合時重新讀四位最新 PR/原 Blob；若 owner 新增 SQL，本 checker 將拒絕「未盤點」新檔，需要**人工 review 並更新新盤點版本**，不可無條件放行；此 R14 快照保持固定歷史。
- **資料庫權威與一致性**：確定 Auth、Billing、Battery、Audit、Task 的**真**物理 D1 資源邊界、表/DDL 衝突、影響會員刪除/免費首次贈送/交易回復的合法一致性；單庫 SQLite 测試只能證明一部分。
- **升級預檢**：逐版本安全順序、舊資料變更/隱私刪除、索引鎖/併發、實際 D1 特性差異、備份保留與逐筆反復活，先在已核准隔離 Staging 用合成資料實測。
- **Rollback 安全**：特別是 Auth `011`、`012` 的 DOWN 會刪除一次性刪帳挑戰保護，**不可**直接當正式 Rollback；若曾真刪帳，必須有經法遵與安全核准的 roll-forward/fail-safe 設計。
- **業主授權**：受控 Staging/正式資源操作、Cloudflare/EAS/Store 費用上限、真保留/刪除政策、值班人與批准紀錄仍為 UNKNOWN/NOT APPROVED。

本文件與四位 R15 工作**不重疊**；等四位回報完成，AI-0 應以來源 SHA + 真 CI 檢驗後另外整合本安全稽核與新程式。**不合併 main、不部署 Cloudflare Preview/Staging/Production、不啟用真 D1/R2/Queues/Secrets/OAuth/Store/EAS／金流，不恢復 H-Global 工程**。
