# AI-0｜R15 四位 Owner 真來源整合、刪帳跨系契約與 SQL 013 安全清單（2026-10-27）

> **狀態：R15 離線整合候選／Await exact-new-HEAD CI。** 此文件不得自行宣告驗收成功。正式 G00～G10 **11/11 BLOCKED**、`PUBLISHABLE=false`。未經業主另外授權，不合併 main、不操作真 Cloudflare Worker/D1/R2/Queue、Store/OAuth/EAS、Secrets、付款或 H-Global 工程。

## 基準與不可偷換的來源

- R14 已驗真同版整合：[AI-0 Draft #106](https://github.com/starry-phd/id/pull/106) fixed `dbb565895489cbe2a3b78eab7006ef0cdc48f01a`。
- 非競合的 SQL 前置稽核：[AI-0 Draft #109](https://github.com/starry-phd/id/pull/109) fixed `0762b52ce39771450f4321bc0668694f83c2be6a`：當時四領域 **36 份 SQL DRAFT** 的 snapshot、Node 檢查器、13 項正負向測試與規劃全部承接。
- 四位 R15 的 **最後固定 HEAD 真 Git Blob SHA** 直接入一個新 Git Tree，未改寫 Owner 真程式，沒有路徑衝突。

| Owner | R15 來源 PR / final SHA | 原樣納入檔 | 實質新功能（僅離線） |
| --- | --- | ---: | --- |
| AI-1 Auth | [#110](https://github.com/starry-phd/id/pull/110) `357948d1fc1e3afc0f6bc515f742aabea971ff09` | 6 | Server-only Auth 已提交刪帳/當下 deleted Member/Session revocation 來源再驗證、精確四欄 Battery DTO、Auth SQL 013 出庫防竄改；無真 Worker 或合法保留批准 |
| AI-2 Billing | [#107](https://github.com/starry-phd/id/pull/107) `0c51f6f40d00c9acee4369d2a14960dedc62d71b` | 3 | 跨域可信 Auth 來源注入、Billing 專屬 HMAC 映射候選與刪帳後權益防重發；**不是** AI-0 正式 P05、無外部 Secret/KMS 或 Store |
| AI-3 Free Battery | [#111](https://github.com/starry-phd/id/pull/111) `c293c88c9839903a1126784faa1dbbace2162aab` | 4 | 離線真 SQLite Auth source 4 欄讀取／Member 已刪/Session 全撤銷驗證、精確 Battery 轉換和 tombstone、重放/竄改拒絕；無真跨 D1 保證 |
| AI-4 Task/API Relay | [#108](https://github.com/starry-phd/id/pull/108) `cec7176857a0334fca4c8b34a662a4bdffe43e6e` | 4 | 真**兩個隔離 SQLite DB** 的 Auth→Battery relay E2E 測試、重試與 race 檢查；**這只是本機雙 DB，非 Cloudflare 真 D1/Queue 或 Production E2E** |

**17 個 Owner source blobs** + **4 個 AI-0 integration/support 檔案**：`docs/operations/r15-sql-additions.v0.json`（保留原 #109 的 36 份歷史 snapshot，另將 AI-1 Auth 013 UP/DOWN **2 份新增草稿的真正 Source Git Blob SHA**獨立記錄）、更新 `docs/operations/verify-r15-sql-inventory.mjs`（舊 36+新 2 個 path 的 fail-closed、逐檔 Blob SHA 檢查及禁止額外未審 SQL）、`packages/integration/test/round15-all-owners-gate.test.mjs`（直接 import 四 Owner R15 模組，在同 checkout 堅守 live OFF、正式版本未核准和 7 域防復活）及本報告。**單 Git Tree／一 Commit／21 變更檔**；上游 Owner 分支維持 untouched。

## 新版 SQL 安全邊界

- R14 baseline 有 36 份 SQL 草稿（Auth 20、Billing 5、Battery/Audit 10、Task 1），保持 **immutable historical snapshot**，不偷改 `baseline.pr=106`。
- AI-1 Auth R15 額外 013 UP／DOWN **2 份**，合計當前 Repo **38 份 SQL DRAFT**（Auth 22、Billing 5、Battery/Audit 10、Task 1）。
- #109 的 CLI/Node 稽核擴充為「舊 baseline + 經檢查來源 SHA 的 013 專屬 addendum」，對所有其他新 SQL 一律拒絕；同名 DOWN 仍絕不代表真回退授權。真 D1 schema version 和合法刪帳/備份恢復尚無證據。

## 跨模組可說/不可說

**離線已跨 Owner 串起 Auth→Battery 的局部契約候選**，並有兩個獨立本機 SQLite 資料庫的 E2E 負測。但 AI-1/AI-3/AI-4 同時存在不同的 server-owned 轉換候選；接續正式開發前仍須由 AI-0 選定**一個**經核准的權威 publisher/transform 位置、單一 canonical schema/version、持久 receipt/ACK idempotency、錯誤傳遞／重試 owner，避免多個版本一起對同一事件做 grant/consume。

Billing 的 derived HMAC digest/member_ref/auth_version 不是 Auth 原始 SQL 的欄位；合法去重/保留 Q104/Q119、真正獨立簽章信任根/Secret、Store/退款權益與 P05 來源仍待正式批准。**R15 各模組 default OFF**，沒有啟用 Queue consumer、Billing entitlement、免費 Battery regrant、Task token 或跨 D1 atomic 全域提交。

## 同 SHA 驗收門檻

上游 Owner 各自來源 SHA 的 GitHub Actions：AI-1 2/2、AI-2 2/2、AI-3 1/1、AI-4 1/1 均成功；**不能代替本整合 SHA** 的 AI-0 full Gate 和 AI-1/AI-2 專責。最終必須從 GitHub 重新核實全量 Node/SQLite `:memory:`、TypeScript/lint、Expo config、Worker dry-run、128 SSOT、11 Release Gate assert-blocked **全部 completed/success**，才能宣告 `R15_OFFLINE_SAME_CHECKOUT_VERIFIED`。

**Release: G00～G10 11/11 BLOCKED；PUBLISHABLE=false。** 無 main merge、無真部署、DB/Secrets/Store/EAS 操作、付費；H-Global 保持停工。第二波管理中心未獲核准。
