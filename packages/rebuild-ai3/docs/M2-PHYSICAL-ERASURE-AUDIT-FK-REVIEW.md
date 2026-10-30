# AI-3｜M2 真實 SQLite 物理刪除障礙：外鍵／來源撤權原子邊界｜2026-10-30

**Status: REVIEW-ONLY / ISOLATED CODE AND REAL LOCAL SQLITE TESTS / NOT APPROVED ERASURE.**  
AI-0 [工作令 #4 #6515992972](https://github.com/starry-phd/id/issues/4#issuecomment-6515992972)；主線 `f153aa601e0a1971366edd9fc5e44b439d2f3c8f`；最新 S2 規範《最新開發技術規範》 v1.0＋流程 v3.0（2026-10-30 業主六項 + S2-08/09/10），Q104/Q119 仍未裁定。2026-10-30 AI-0 [五組同樹 #285](https://github.com/starry-phd/id/pull/285) [Actions #41008691181](https://github.com/starry-phd/id/actions/runs/41008691181) 已 3/3 SUCCESS，**本次不重做其 Owner source 或 witness TOCTOU**。

## 真正在來源發現的物理刪除阻塞（精確來源）

AI-1 已在 main 的三個 DRAFT SQLite schema：

- `modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql`：`starry_identities`、`starry_sessions`、`starry_admin_grants` 都由 `s_user_id` FK 指向 `starry_members`。
- `modules/starry-id-v1/schema/002_m1_local_oauth_attempts.DRAFT.sql`：`starry_m1_audit_intents.s_user_id REFERENCES starry_members(s_user_id)`，包含 member_registered/session_issued 最小來源意圖；**這個先前的 M2 FK 審閱容易遺漏**。`starry_m1_oauth_attempts` 無 member FK，不能因此假設 OAuth state／sealed verifier 不須額外按法定期限清理。
- `modules/starry-id-v1/schema/003_m2_local_member_self_mutations.DRAFT.sql`：`starry_m2_member_mutation_audit.s_user_id REFERENCES starry_members(s_user_id)`；`UPDATE starry_sessions.revoked_at` 的 source-side audit trigger 反而會新增另一筆此表的會員可連結證據。其 `s_user_id`、`session_id`、event ID 不是無個資，不能僅因不存姓名就認定可永久保留。

**真正反例**：在 SQLite `foreign_keys=ON` 且三份 DRAFT schema 的合成會員資料下，即使先刪 `identities/sessions/admin_grants`，刪 `starry_members` 仍因 **M1 與 M2 兩張 audit 外鍵**拋 `FOREIGN KEY constraint failed`。在單一 `BEGIN IMMEDIATE` 來源交易中先 `status=deleted`、`auth_version+1`、`display_name=NULL` 並撤銷所有 Session（同時增加 M2 audit），之後若物理刪帳遭 FK 阻擋，**必須 ROLLBACK 整個交易**：會員狀態／版本／PII／Sessions／audit 均不得留下半完成紀錄。測試真的執行上述 SQL 並驗證回滾。

## 可執行的新工程切片（非另一份 HOLD 模擬）

- `src/m2-local-erasure-fk-preflight.ts`：AI3-only 只讀 SQLite source scanner，直接使用 `PRAGMA foreign_keys`、`PRAGMA foreign_key_check`、所有實際 `sqlite_master` tables 的 `PRAGMA foreign_key_list`，核對五類 `s_user_id` FK 是否具體存在；按會員識別查 `identities`、`sessions`、`admin_grants`、**M1 + M2 audit** 的真實引用行數，辨識未知新增 FK、缺 migration、FK 被關閉或 integrity 違反。輸出只有類別／數量／必要阻塞，不回傳會員 ID、subject、token、姓名、稽核原文，不提供任何 UPDATE/DELETE/授權方法；未核法律和外部 PITR 時即使引用歸零也不放行物理刪除。
- `test/m2-local-erasure-fk-preflight.test.mjs`：使用 Node22 **原生 `node:sqlite` `DatabaseSync(':memory:')`**，讀 GitHub 原有 001/002/003 schema 真正建表與觸發器，用合成資料執行 FK 失敗、回滾、未知入向 FK、壞 FK、缺 schema、無引用但法律未知等正反例，**不是靠假的 mock 判斷**。不對真 D1 做 SQL。

## 下一個「可落地」修復界線：須由 AI-0/法遵裁決的二條資料類別路徑

| 資料類別 | 確定的物理技術限制 | 可審候選處置，**尚未批准** |
| --- | --- | --- |
| 一般會員五欄、公開投影 | 不能保留一般 PII 作為「停權」的替代 | 有效申請後合法去除；實體 DB/Cache/外部同步與 PITR 復活防線要有驗收 |
| 身分 provider mapping、所有 Sessions/refresh、admin grants | 001 FK 及 revoke 的生效／競態 | AI-1 唯一來源權威內原子 auth_version bump + revoke ALL Sessions，再依法清理；如任何步失敗，不能回覆刪除成功 |
| **M1 `starry_m1_audit_intents`** | FK `s_user_id`；保留原 ID 阻止物理刪除 | **選項 A** 法遵判定不須留：在受審交易中刪除其必要已核准範圍；**選項 B** 若有合法保留義務：先核具體目的、法源、資料最小化、不可反向識別的轉換策略（不可假定換 hash 即匿名）、存取/期限與外部隔離，再設計無會員 FK 的受控必要記錄。不可先繞 FK 或永存 identifier。 |
| **M2 `starry_m2_member_mutation_audit`** | FK `s_user_id` + Session revoke 觸發器會新增行 | 同上兩路（A/ B）按**每種事件類別**決定，不可以 `ON DELETE CASCADE` 或 `PRAGMA foreign_keys=OFF` 偷渡刪除；若合法必要就不可直接丟棄 |
| OAuth attempts / processor / Billing / Battery / Backup/PITR | 002 OAuth attempts 缺直接 FK；可能另有跨儲存引用 | 不是「FK=0 ⇒ 全部已刪」，後續獨立逐類盤點、核准保留/清除/第三方傳播，合法防首贈重領 source 與獨立防復活 witness 必須另外成立 |

**重要**：即使在**測試本地 SQLite**中能手工刪掉兩張 audit，不能將該操作預先等同於已批准的法定清除，更不能改 AI-1 的 001～003 DRAFT 正式 schema 或自動 migration。具體法定期限、Q104/Q119 審核結果目前未知，所有候選處置均以「未批准」列示。

## 必須由 AI-1 實作的真正來源交易約束（本 PR 不越權）

1. 一個可信的 Starry-only 會員與 Session 來源庫，先通過現行 Auth/version/step-up/delete request 身分驗證；不能用請求附的 `s_user_id` 當寫入權威。
2. 在**同一個**具實際 DB transaction semantics 的來源交易中核對受影響版本與最終 `WHERE` write fence，執行會員狀態/授權 epoch/全 Session revoke/已核准個資清理/必要 outbox（不可將失敗 ACK 當完成）。如果真 D1 runtime 無法保證所用 API 的原子性，需另出受審交易設計與故障測試，不能複製 Node SQLite 的 `BEGIN IMMEDIATE` 假稱真 D1 可用。
3. 依審定的逐類 audit 保留策略清除或受控轉移上述 M1/M2 FK，逐類檢查 `PRAGMA foreign_key_check` 與實際無資料復活；遭任一 FK／合法保留／故障阻擋必須進入未完成／待重試狀態，**不得對會員顯示已物理刪除完成**，但不能無限拒絕有效刪除申請。
4. 外部 Store／RevenueCat／公開搜尋／通知與備份恢復同步只有經各 Owner 審定的分離策略及實際驗收後才能回覆全域完成；真獨立不可回滾 witness 尚不存在。刪後重新註冊不先發 Battery，仍保持 `PENDING_VERIFICATION`。

### 交接與回退

P06／P09：本地分析與原生 SQLite 重現測試留在專責 AI3 Draft PR + GitHub Actions exact SHA；若未通過 AI-0 Gate，只須關閉 Draft，無外部資源可回滾。M2 真持久化/寫路由需 AI-1 + AI-0 + 法遵另准，G00～G10 BLOCKED；Battery 永久免費，Ads OFF、HGlobal/Echo 不介入。
