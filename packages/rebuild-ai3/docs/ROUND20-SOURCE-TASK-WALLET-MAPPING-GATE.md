# AI-3 R20｜Task 來源／Wallet 持久收據語意一致性 Gate（離線候選）

**上游正式依據**：AI-0 Issue #1 R20 [派工](https://github.com/starry-phd/id/issues/1#issuecomment-6447409526)、AI-3 Issue #4 [明確任務](https://github.com/starry-phd/id/issues/4#issuecomment-6447460851)、最新四 Owner R19 同版 [Draft #137](https://github.com/starry-phd/id/pull/137) 固定 `b713cbbc44307a325fec71fff74c81defbd95c71`、#70 Git Tree SOP、#87 跨 D1 ADR。R18 / R19 已完成程式與測試**不重做／不改寫**。

## 本輪新增可執行邏輯

`src/r20-task-wallet-source-binding.ts`：只讀 3 個由 server 配置的 port：
1. **離線假設 source**：`{brand_id,environment,member_ref,task_ref,event_ref,event_type:'task_committed',auth_version,attempt_no,policy_version,committed_at_ms}`。注意：**AI-1 R19 真來源的 `account_deleted` 是不同事件語意**，目前**沒有**正式權威的 `task_committed` signed Publisher。函式拒絕把 `account_deleted` 或 Store `refund` 的 event ref 當 Task 來源。
2. **離線獨立 Task DB**：`{brand_id,environment,member_ref,task_ref,source_event_ref,status:'committed',attempt_no,policy_version,committed_at_ms}`；與 source 逐欄 scope/member/task/event/attempt/policy/time 匹配，不靠名稱相似或 bool 聲稱官方身分映射。
3. **既有真實 AI-3 R19 Battery read-only Gate**：直接調 `createOfflineR19TaskWalletReview(...).inspect()` 取得 R19 測試/本地收據，該 Gate 沿用既有 R7 Battery Wallet/Hold/Journal SQL；必須 `status=review_only` 且 `may_ack_queue` 等旗標完全 false，`source_event_ref`、`wallet_revision`、`task_attempt`、`policy_version` 一致。缺 floor、PITR 舊 Wallet、未結算 hold、重複 commit 會被原 R19 Gate 拒絕，R20 不可繞過。

先核合法處理目的／最低保留／Policy，最後再次檢查；重讀兩輪 source/Task/R19 Battery Gate，偵測部分提交／異步變動。Node 負測涵蓋事件 namespace、冒用簽名/多餘欄位、會員與環境錯位、雙 commit 與版本漂移；Python 實際使用**三套彼此獨立的 SQLite `:memory:` connections**（假設 Auth source DB、假設 Task DB、真 AI-3 R7 Battery schema）驗證來源對不上、Task 已 commit 但 Wallet 未 commit、第二次寫入失敗、PITR 舊快照。**不涉及真 Cloudflare D1 或跨庫 ACID**；Node 的假 source 不能當 AI-1 真正式來源。

## AI-4 私有交接（僅 review-only，非授權）

最小候選 DTO：`kind=OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING`、`brand_id`、`environment`、`member_ref`、`task_ref`、`source_event_ref`、`task_attempt=1`、`policy_version`、`wallet_revision`、`signed_source_approved=false`、`member_mapping_approved=false`、`independent_floor_approved=false`。**member_ref 可能是個資**：只在依法許可的內部唯讀資料流使用，禁止向公開 Client、Log 或外部 Queue 暴露。禁止擴充 OAuth subject、郵件、Token、Store SKU、售賣欄位。

即使三庫假設資料完全相符，返回仍為 `review_only`，`may_settle,may_release_task,may_ack_queue,may_regrant,may_restore,may_publish,may_sell_battery,live` **永遠 false**；沒有 live writer、ACK、Publisher 或真 Task release 操作。

## 不可擅自解除的阻塞

#87 物理跨 D1 A/B 尚未裁決、正式 P05 signed 唯一 Publisher 與 task event canonical 映射、合法 Q104/Q119 留存／HMAC/KMS／獨立 anti-PITR floor、真 D1/Queue/DLQ/Store/EAS/OIDC、費用限額都待批准。**G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false**。不合併 main、不部署任何 Preview/Staging/Production、不觸真資料庫/Secrets/付費；H-Global 暫停；免費 Battery 不出售兌換。
