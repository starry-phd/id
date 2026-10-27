# AI-0 ADR 草案｜Starry 跨資料庫一致性選項（2026-10-27）

**狀態：候選研究；未裁決、未授權部署。** 依據已驗收 R10 [PR #82](https://github.com/starry-phd/id/pull/82) 和 [GitHub Issue #1](https://github.com/starry-phd/id/issues/1)。本文只涉及 Starry，H-Global 工程暫停。

## 已證實的問題
AI-1 的會員／Session／首次贈送權威、AI-3 的免費 Battery Wallet 與 held-task journal、AI-4 的已提交 AI Task 若分在不同資料庫，任一資料庫的成功交易均**不能證明所有資料庫同時提交**。R10 AI-3 [#81](https://github.com/starry-phd/id/pull/81) 的 D1-shaped batch 只在單一 DB 的 SQLite 模擬中通過；AI-1 [#79](https://github.com/starry-phd/id/pull/79) 的 Auth fence 仍需獨立不可回退見證；AI-4 [#77](https://github.com/starry-phd/id/pull/77) 的 Task digest 不能自行證明來源可信。AI-2 [#78](https://github.com/starry-phd/id/pull/78) 本機 SQLite 對帳不代表官方商店和實際 D1 已驗。

## 三項可比較方案（尚未選定）

| 候選 | 優勢 | 核心代價／風險 | 評估 |
| --- | --- | --- | --- |
| A：Starry 專用的**單一交易權威**儲存特定 first-gift claim + wallet grant | 同一交易內唯一約束、CAS、日誌較容易核實 | 要重審最小個資、DB 資源界線、會員撤權競態、備份與搬遷；不得合併 H-Global 資料 | 優先研究可行性，**不代表已核准合庫** |
| B：保留各服務 DB，使用**持久 Outbox／冪等 Saga** | 保持 Owner/資料隔離，易定義非同步補償 | 不提供跨庫即時原子性；部分成功、重試、刪帳、逾時及個資保留複雜；必須明確禁止未確認贈送變成可消費 | 備選，需先寫完整狀態機 |
| C：只做跨庫預讀、由 Wallet 單庫 CAS 提交 | 既有離線工程改動少 | 會員可在預讀後撤權，claim 與贈送可能不一致；不能宣稱總體交易成功 | **只能維持離線候選，不可做正式寫入** |

不能假定 Cloudflare 提供跨多個 D1 的全域原子提交，除非未來取得權威文件與實際測試證據。不得把同一 Cloudflare 帳號解讀為可跨 DB 原子交易。

## 下一輪整合必驗的負面情境
1. 首註去重 claim 成功，但 X 電池贈送失敗／timeout：不可重新贈送，也不能把未知結果視為已可消費。
2. X 贈送已提交，claim 來源回覆中斷：以持久提交證據而非 client bool 調查，不重發、不自動補發。
3. AI Task 成功、Wallet 結算前會員刪帳／Session 撤權：當下權威缺失時拒絕，不採預讀快照。
4. 兩個 Worker 重試同一 task、超過三分鐘 hold、policy revision 改變：只能一次成功，其餘回滾／拒絕。
5. PITR 復原時刪帳、首註 claim、Task、Billing outbox 較新：無獨立不可回退見證就只能 review_only／blocked，不得 restore。
6. 任務 watermark 相等但逐筆內容變更或 Anchor 失效：拒絕恢復。
7. P05 Queue ACK 遺失、付款退款亂序／跨品牌 env 錯配：未有 durable committed source 不 ACK、不重授 paid entitlement；免費 Battery 不與付費 SKU 混合。
8. Q104/Q119 的身份去重可能涉及個資：先經合法目的、保留/刪除與撤回 Gate；不得永久保存原始 OAuth subject 或假設 HMAC 已匿名。

## AI-0 架構裁決之前的門檻
- 釐清 Starry **實際** Auth／Gift Claim／Task／Wallet／Audit 權威 DB 擁有者與寫入權，保持 H-Global 完全隔離。
- 要提出 A、B 各自完整的交易狀態機、crash/retry、法遵／補償、成本與資料移動風險。
- 任何真 Cloudflare D1/Queue/PITR、Store/OAuth/EAS 的受控測試，都要事先取得業主明確批准與成本限制。
- 正式 G00～G10 現為 11/11 BLOCKED；此 ADR **不解鎖任何 Gate，也不要求正在開發 R11 的四位 AI 停工或變更基準**。
