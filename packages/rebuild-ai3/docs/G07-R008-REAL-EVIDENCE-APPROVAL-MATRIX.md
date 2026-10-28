# Starry ID AI-3 — G07 真實稽核／Queues／DLQ／復原 Gate 證據缺口與授權清單

> **Post-R008 review-only; 非第九輪程式、非真 Cloudflare 驗證或發布許可。** 取自 AI-0 最新 [Issue #1](https://github.com/starry-phd/id/issues/1#issuecomment-6477805792) P1 G07 責任、[Issue #220](https://github.com/starry-phd/id/issues/220) 交接與 [PR #235](https://github.com/starry-phd/id/pull/235) 歷史實體盤點。只開發 Starry ID 中央系統；不涉及繁星回聲或 H-Global。父版本 [#237](https://github.com/starry-phd/id/pull/237) ac99611e00c32c0f5945fb9989807b0dd2dda1a9，未重寫 R008 [#234](https://github.com/starry-phd/id/pull/234) 的四組 12/12 Git blobs。

## 0. 目前正式狀態（必須和官方 source-of-truth 分開）
- 官方 `docs/release-readiness/release-readiness.v0.json` 中 **G07-AUDIT-QUEUE owner=AI-3, status=blocked, evidence=[]、verified_by=null、approval_record_url=null**。所需兩組證據原文：①「真 Cloudflare Queue/D1/DLQ retry、ACK-after-commit、持久隔離、災難恢復」；②「多 Worker 原子性、失敗重送、私隱遮罩/保存/人工重播核准」。本文件和下述 JSON **絕不填充 official evidence、不將 G07 改 PASS**。
- [R008 四 Owner 合版 #234](https://github.com/starry-phd/id/pull/234) SHA `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9` GitHub [同版離線 CI #40745802066](https://github.com/starry-phd/id/actions/runs/40745802066)：1,776 Node＋413 SQLite memory PASS。AI-3 [#232](https://github.com/starry-phd/id/pull/232) 34 項本機 P05/P06 回復／撤權／刪除負測成功；**不代表**真 D1/DLQ/獨立 durable witness 已存在。
- AI-0 [#235](https://github.com/starry-phd/id/pull/235) 的**單一 Starry Cloudflare 帳戶歷史 API 查詢**為 Workers 6、D1 1（名稱 `echo-starry`，不是已驗 Auth/Audit D1）、Queues 0；`id-starry` Preview/production automatic Builds OFF。此次 AI-3 **沒有再次查 Cloudflare、不能稱即時狀態或產生新服務**。
- Gate1 PARTIAL/BLOCKED；Gate2 R008 只有 OFFLINE PASS；Gate3 G00～G10 **11/11 BLOCKED**，`P05/PUBLISHABLE=false`、`release_authorization.granted=false`。Battery 永久 FREE，Ads OFF，Expo54 保持。

## 1. G07 接受標準與另行核准表

| ID | 責任與正式阻塞 | 真實驗收應取得的證據 | 在無授權下僅能做的事 |
|---|---|---|---|
| G07-01 | AI-0 + AI-3；Architecture and data ownership | Approved topology showing exactly one authoritative receipt/outbox owner per event；Versioned consistency and compensating-action semantics, including no cross-D1 atomicity assumption；Failure and replay ownership, rollback and escalation owner | Document A/B consequences and acceptance criteria only |
| G07-02 | Owner/legal + AI-3；Legal policy and P06 erasure | Per-event lawful purpose, jurisdiction, minimum data fields, retention/disposition rules approved by legal；Approved erasure vs legal-hold state transition and data-resurrection prevention requirements；Evidence that masked audit trail and manual replay comply with approved policy | Record unresolved decision questions without selecting retention period |
| G07-03 | Owner + AI-0 + AI-4；Starry-only test resource & spending authorization | Explicit Starry-only account, resource names, isolated Worker identity and test data classification；Separate authorized D1, Queue, DLQ, bounded retention, IAM and Access config；Budget cap, rate limit, spend alerts, expiration/cleanup plan and rollback owner | Write resource request checklist and minimal evidence labels |
| G07-04 | AI-3 + AI-4 + AI-0；Commit-before-ACK / retry / DLQ | On a separately approved test-only stack, prove durable receipt+outbox commits precede ACK；Forced crash before commit, after commit before ACK, duplicate delivery, consumer restart and DLQ replay are idempotent；Stale Auth, P05 schema version disagreement, privacy-hold or erasure guarantee fail-closed with no send/grant | Keep #232 deterministic memory fixture as NON-LIVE evidence, not Gate PASS |
| G07-05 | AI-0 + AI-3 + security reviewer；Independent anti-PITR and recovery | Distinct failure domain and signed monotonic durable witness with independently reviewed key ownership；Adversarial restore demonstrating older primary snapshot cannot revive revoked or erased event；Restore/recovery runbook: witness outage, compromise, conflicting floors, partition, incident and evidence escalation | Audit failure model and explicit reject conditions |
| G07-06 | AI-3 + AI-1 + owner/legal；P06 audit data minimization and privileged replay | Versioned P06 actor/action/resource/result/permission/time/correlation_id and masking rules；Authorized read/export scopes, two-person/manual replay approval and immutable audit evidence；Access audit and request/resolution timeline without personal-data leakage | Link P06 required contract; no operational account or privileged API exposed |
| G07-07 | AI-3 + AI-4 + AI-0；Monitoring, DLQ and operational ownership | Durable dead-letter depth/age, retry rate, duplicate rejection and recovery RTO/RPO targets approved；Alert destinations/escalation contacts and safe manual replay criteria；Cost/usage bounds, alert simulation artifacts and rollback audit trails | Prepare human-review checklist only; P07 monitoring interface is a separate ADMIN-PREP item |
| G07-08 | AI-0 Gate owner + owner approver；Formal Gate evidence and release authority | Approved source-of-authority URLs, exact environment/commit/protocol version, independent witness and legal reviewer attestations；Real connected test results and explicit AI-0 review of G07 against G06/G03/G08/G10 dependencies；Separate owner approval for any release or paid resources; no implicit Gate transition | Leave official Gate JSON entirely unchanged; this packet is NOT official evidence |

## 2. 先決決策／禁止偷偷選項
1. **#87 A vs B**：真跨 D1 交易架構由業主與 AI-0 核准。A 單 Starry 交易權威與 B durable outbox/saga 的 D1 所屬、冪等、補償、PITR 權責尚未定。不可依本機 SQLite 單交易演練推定 B saga 已完成。
2. **Q104/Q119**：法律保留期限、用途、刪帳與稽核 masking、爭議 hold、撤權後晚到通知、PITR 恢復防資料復活尚待法務／業主審定。不可自行選天數、永久保存、清除自動化或存取真會員資料。
3. **G06 P05 事件契約**：已有 [#236](https://github.com/starry-phd/id/pull/236) 實際來源對照：ADMIN-PREP 11 核心＋條件性 idempotency，release G06 13 欄**未列明**，R006 17 欄是非 Live 候選。未決不得制定正式生產 publisher、簽章 envelope 或 queue payload。
4. **G03／G08／G10 相依**：current Auth/session 可信來源、受保護 Worker、事故回應與費用預算也須各 owner/AI-0 驗證。AI-3 不越權修改這些領域 writer 或資料庫。

## 3. 若業主準備核准「分離的測試環境」：申請事項，不是已授權工作
每一筆申請必須由業主明確批准：指定 Starry-only 帳戶與隔離測試 Worker、test-only D1、Queues + DLQ、資料種類與禁止使用真人 PII、IAM/Access 和 Secrets 管理負責人、獨立 durable witness 的服務與信任域、成本上限與停止/清理方案、測試期間與授權 URL、事故／回退責任人。**請勿將 `echo-starry` 直接挪作 audit 或 Auth 正式 D1。**

未取得上項核准時，本文件不包含任何 CLI 建置/綁定/部署指令，不會修改 `wrangler.toml`、Workers Builds、GitHub CI workflow、D1、Queue、R2、Secrets、main、Gate JSON，也不會產生費用。Cloudflare Preview 保持 OFF。

## 4. AI-0 接手判定及驗收紀錄
- 先請業主裁決 #87、P05 G06 欄位來源與 legal Q104/Q119。**法務/架構仍未決，則 G07 維持 BLOCKED**。
- 若獲許可建立 test-only 資源，才可以另開隔離分支與 Draft PR，執行真實 protected Worker→D1 commit→Queue ACK、重送／DLQ／災復、獨立 witness、隱私政策與 P06 稽核的受控測試。每個測試需留下資源所有權、可重現故障、精確原始紀錄、失敗與回退、環境、版本、人工審批 URL。
- **真測試過關也不會自動變成 Production 權限**：G07 由 AI-0 依 official Gate 執行受控審核，且另待業主 release authorization。AI-3 僅按 G07 Owner 責任交證據。
- **回退**：關閉本 AI-3 唯讀文件 Draft、棄新增兩個 `packages/rebuild-ai3/docs/` 檔。#237、#236、#235、#234、#232 和 main 不受影響。

## 5. 附件和範圍
配套機讀 `G07-R008-REAL-EVIDENCE-APPROVAL-MATRIX.v1.json` 列出 8 個 `blocked` 待驗證項目，且核准旗標皆 false。它是 GitHub 歷史來源核對的**候選清單**，不是 live attestation、預算核准、法律文書、G07 evidence 或正式持久資料。