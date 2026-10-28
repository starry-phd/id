# AI-0 D87｜Starry 中央會員單一交易權威架構方向正式決議（2026-10-29 台灣）

- **決議狀態：業主核准方向 A — `OWNER_DIRECTION_A_APPROVED`；詳細設計／真資源／Live Gate 均 `NOT_AUTHORIZED`。**
- 正式唯一業主決議來源：[AI-0 Issue #1 #6478861308](https://github.com/starry-phd/id/issues/1#issuecomment-6478861308)；引用使用者當次核准：「核准 Starry 中央會員系統採 A：單一交易權威架構方向。……此核准不包含部署、建立資源、付費或合併 main。」
- 參考的歷史候選：[跨 D1 一致性 Draft PR #87](https://github.com/starry-phd/id/pull/87) 之 `docs/adr/AI0-R11-CROSS-D1-CONSISTENCY-20261027.md`，及 [AI-0 #242](https://github.com/starry-phd/id/pull/242) 整合的四組 POST-R008 工作。舊 ADR 上寫的 A/B 未裁決歷史狀態已被本業主決議更新；原文不改，以保留審計歷史。

## 1. 已核准的 *方向*（精確而不擴大授權）

對 **Starry 中央會員系統** 第一波跨模組一致性需求，採 **A：單一交易權威（single transactional authority）**。要求 AI-0 及專責 Owner 設計時，將首註去重 claim、免費 Battery 可消費授予、其他需要原子一致性的核心寫入，以**明確的一個事務權威**作為結算和可追溯事實來源；以權威資料的唯一約束、CAS、同一 transaction 內持久化與 committed outbox 作為驗收設計目標。

**本方向不等於：**已核准所有 Auth、Billing、Wallet、Audit 資料在同一個 D1；已決定 D1 數量、命名、位置、Region、Schema、資料遷移或營運帳戶；自動允許跨 D1 原子交易；或對 H-Global/「繁星回聲」/其他產品 App 作出開發授權。資料領域依然維持唯一 writer/最小權限與個資最少化。

**非同步跨服務行為**仍須明確設計：權威成功提交後才投遞事件，consumer durable inbox、冪等、重放拒絕與必要補償。正式 P05 事件 envelope 尚待下一項 D06 決議，不能因 D87=A 而直接啟用。

## 2. 尚未核准的執行細節（Open Design & Gate Tasks）

1. 具體事務範圍：first-claim / gift / wallet / task / entitlement 各自的單一寫入權威與該權威內的 SQL transaction 範圍；需要 AI-1/2/3/4 逐域 review。
2. 會員 Auth 與交易 DB 的關係、撤銷後反向寫入拒絕、跨域 read-after-commit、signed event trust；不要使用過時 Session 快照保證當下授權。
3. 退款／權益與免費 Battery 邊界：Billing 仍須官方 Store、P05 和 D1 真實驗證，不把 Battery 變為付費商品。
4. Q104/Q119 的刪除、法務保留、首贈去重／合法證據、PITR 後撤權／刪除不得復活；獨立 witness 的權威/保護/故障域仍待正式決定。
5. 真 Cloudflare D1/Queue/DLQ、Worker/Access、Secrets/issuer、費用上限、隔離 test-stage、監控／告警／恢復與實際負向測試：**全部另行逐項業主批准**；本 ADR 不做 Live 操作。
6. AI-0 應優先完成下一項 D06 P05 契約方向及 G00/G01 的中央專用範圍，再依批准成果規劃 G05/G07 真實驗收；任何 Gate PASS 須外部可驗的授權與證據。

## 3. 架構方向與正式 Gate 分離

| 項目 | 本次結果 |
|---|---|
| D87 架構選項 | **A（業主已核准方向）** |
| B durable outbox/saga 作為完整事務權威替代方案 | 非本次選定方向，僅保留歷史備選 |
| Durable outbox/inbox 非同步可靠交付 | 可在 A 下繼續設計；不是 B 整體交易方案的偷渡選擇 |
| D1 數量、schema、region、資源、法律保存政策 | **未核准** |
| G05 Billing D1 | **BLOCKED**，無真實 D1/交易證據 |
| G06 P05 | **BLOCKED**，13 欄來源／11+conditional／17 candidate 未裁決 |
| G07 Audit/Queue | **BLOCKED**，無真實 D1/Queue/DLQ/anti-PITR |
| G00–G10／Release Gate | **11/11 BLOCKED**、`evidence=[]`、`release_authorization.granted=false` |
| main merge／Staging／Production／Preview／Cost／Secrets／Paid／H-Global／繁星回聲 | **全部未授權** |

此為 **業主正式架構方向決議的 GitHub 版本化紀錄**，不應改寫既有 R008 Owner 原件或正式 Gate JSON，亦不宣稱最新 Draft PR 已合併 main。