# AI-0｜R14 四位 Owner 真程式 × 一波 ADMIN-PREP 同版整合（2026-10-27）

> **候選狀態：DRAFT / AWAITING_NEW_SHA_CI。** 只有本次整合 PR 的固定 HEAD 全部 Actions completed/success，才能宣告 R14_OFFLINE_SAME_CHECKOUT_VERIFIED。Owner 不同 SHA 的綠燈只證明各自程式，**不**等於跨資料庫刪帳同步完成。
>
> 正式 G00–G10 11/11 BLOCKED；無 main merge、Cloudflare Preview/Staging/Production、真 D1/R2/Queue、Store/OAuth/Secrets/EAS、付費。H-Global 工程仍暫停。

## 基座與實際來源

整合基座：[AI-0 R14 P01–P10 平行驗收 Draft #102](https://github.com/starry-phd/id/pull/102)，固定 `8f5d6a565cb8805b01ed208f5a445afc650e5815`；先前 [R13 已驗四位整合 #100](https://github.com/starry-phd/id/pull/100)，固定 `dc798cacea55cc376ed993876c0971035353d688`。保留 #102 四檔 P01–P10 候選 ledger、驗證器與安全負測原樣，不修改功能狀態，也不授權第二波 UI。

| Owner | 最終 R14 Source PR／HEAD | 完整來源檔案 | 已完成的實際新程式（仍為離線候選） |
| --- | --- | --- | --- |
| AI-1 | [#103](https://github.com/starry-phd/id/pull/103) `35889a0d82ecfeccc0fb3aefd38d6862ca4766b8` | 6 | Session 綁定的 one-use 刪帳 Step-up challenge 發行，SQLite 作用域/Session/Step-up CAS 及負測；**沒有真 Passkey/TOTP、Live D1** |
| AI-2 | [#105](https://github.com/starry-phd/id/pull/105) `490c3f941764b32325a6ce5b6df78b8d60de4620` | 4 | 可信刪帳證據候選、同庫 Billing tombstone 單調防復活/取消權益，SQLite 負測；**沒有真 Store/D1/Queue** |
| AI-3 | [#104](https://github.com/starry-phd/id/pull/104) `69783a039501523b18a70a4612b7ace375f0d47c` | 5 | Auth 已提交刪帳事件 -> 免費 Battery 同庫 tombstone、釋放 held 與 journal/inbox 一次性記錄；**只證明 Battery 單庫事務，非跨 Auth DB 原子** |
| AI-4 | [#101](https://github.com/starry-phd/id/pull/101) `8a80ab2b7d833d7df1bf3ac0f22b4df97bdca42c` | 4 | committed AI Task + 同一 Task DB 持久 outbox 一起 CAS、故障回滾/重播負測；**非跨 Task/Wallet D1 交易與真 Worker** |

**真 source integration**：四位的 19 個變更檔案，逐一從各最終 Git Source Tree 以原始 Blob SHA 放入**同一新 Git Tree**，無重疊路徑，不改寫 Owner 程式。另新增 AI-0 `packages/integration/test/round14-all-owners-gate.test.mjs` 和本交接報告 **2 檔，合計 21 檔／單 Git Commit**。

## 跨 Owner 新發現的重要接口缺口（BLOCKED，不能假稱已整合）

這一輪 Auth → Billing/Battery 的刪帳流程**尚未有權威 P05/域內事件映射器與真 committed receipt**：

- AI-1 R13 SQLite Auth deletion outbox 原始欄位：`event_id, s_user_id, occurred_at, event_type`，詳見 `modules/starry-id-v1/schema/011_starry_one_use_deletion.UP.DRAFT.sql`。
- AI-3 R14 Battery Consumer 目前接收的 `AuthDeletionEvent` 形狀：`event_id, member_ref, occurred_at_sec, event_type`。至少需要受保護服務端映射（`s_user_id -> member_ref`、`occurred_at -> occurred_at_sec`），不能相信 client 自傳或 raw Queue JSON 就能完成權威驗證。
- AI-2 R14 Billing Consumer 另要求 `brand_id, environment, event_ref, event_digest, auth_version, occurred_at_sec` 等欄位、真 Auth commit/當下刪帳狀態證據；這些**不是** Auth 原始 SQL outbox 的相同形狀，也不能用空白值/推測 hash 補齊。
- AI-3/AI-2 所要求的可信驗證與 cross-D1 delivery 仍是注入的離線 Ports，`may_ack_queue=false`／`may_grant=false`；未有正式版本化的 deletion schema、Store/Wallet/Task 全域一致性或 Queues ACK/重播憑證。
- AI-4 Task outbox 也只在 **Task 自己 DB 內原子**，不能證明 Wallet 的 Y 贈送、消費扣抵與 Auth 刪除跨庫同時正確。

**因此下一輪優先由 AI-0 進行事件契約裁決與對應 Owner 領域的提案**；在得到正式權威資料、法律/隱私保留和真 Cloudflare/D1/Queue 測試的獨立授權以前，不啟用任何刪帳 consumer、Outbox 或 Store 權益。

## 驗收邊界

- 整合測試直接 `import` 四位 R14 真模組、已完成 R13/R12 的安全旗標，檢查所有 LIVE/Store/Restore/Task 仍關閉；確認 7 個不可復活 Fence。
- 對 Auth SQL outbox vs AI-3/AI-2 事件欄位做明確的 **schema mismatch regression guard**，暫時只報告缺口而**不**偷偷寫映射器或解鎖 Live。
- GitHub Actions 只認**本 PR 最終 HEAD** 的新 AI-0 full offline Gate、AI-1、AI-2 專責 CI success，包括 TS/lint、Node、SQLite memory、Expo config、Worker dry-run、正式 11 Gate `--assert-blocked`。
- 上游每組離線 CI success（AI-1 #103 2/2、AI-2 #105 2/2、AI-3 #104 1/1、AI-4 #101 1/1）不能替代跨四組同 checkout。

## 待業主決議／真環境 Gate（不代填）

Q104/Q119 法遵與刪除/反復活保留期、受核准的 Source Identity、跨 Auth/Billing/Battery/Task 獨立 D1 的可恢復 outbox/Saga、真正簽發者與不可回退見證、正式 P05 Version、Store OAuth、Cloudflare Worker/D1/Queues/DLQ、EAS/原生裝置、首款 App／SKU、Battery X/Y/費率與成本限額。第一波 P01～P10 只是證據追溯候選，**第二波管理 UI 未開發/未授權**。

**嚴格安全**：G00～G10 11/11 BLOCKED。Draft/Open/Unmerged，沒有合併 main、沒有真 Cloudflare Preview/Staging/Production、DB/Secrets/Store/EAS/付費或 H-Global 部署。
