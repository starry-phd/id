# AI-1 R20｜Auth committed-source 語意與身分映射防混淆（離線 Draft）

**正式指派**：[Issue #2 R20](https://github.com/starry-phd/id/issues/2#issuecomment-6447458131)；[AI-0 Issue #1](https://github.com/starry-phd/id/issues/1#issuecomment-6447409526)。基準為已驗 [AI-0 R19 Draft #137](https://github.com/starry-phd/id/pull/137) 固定 `b713cbbc44307a325fec71fff74c81defbd95c71`。遵守 #70 Git Tree SOP、#87 尚未裁決跨 D1 A/B。R19 `createOfflineAuthCrossDomainDTO` 已有功能完整沿用，不重作。

## 新版契約（在程式與負測中實際落實）
- `createOfflineR20AuthIdentityBoundary.inspect(realSealedAuthClaim,request)` 預設 OFF、唯讀、Starry development/staging，需先通過法律目的、最低資料保留及政策版本。
- Auth R19 原始四欄已提交 Outbox/刪帳時 Session 撤權/Challenge/lease 再驗兩輪（多庫前後）。讀取三個**分離且僅離線的** Billing Store 退款事件、Task 執行、假名摘要候選 port，逐一核對 `namespace,ref,environment,provenance='unapproved_mock'`。假相等、交叉品牌、政策/來源漂移一律 `blocked`；即使所有本機候選一致也僅 `review_only`。
- **不同命名空間不可互認**：`auth.account_deleted / billing.store_refund / task.execution / member.pseudonymous_digest`。四種參考值是不同的事件與識別用途，字串相同不代表來源相同。尤其 Store 退款事件 ≠ Auth account_deleted；Task ref ≠ 帳號；digest 並非已核准 HMAC 身分對應。
- **最小對外結果**：版本 `starry.auth.identity-boundary.v0-offline`；`source:{namespace:'auth.account_deleted',event_id,auth_version,policy_revision}`，**完全不攜帶** raw `member_ref`、digest、退款交易或 Task 編號給 Billing／外部。這不是不可回退證據、官方簽章、合法用途或 P05 權威。
- 任何結果 `identity_mapping_approved=false,may_publish=false,may_ack_queue=false,may_restore=false,may_regrant=false,may_release_task=false,live=false`。沒有 publish/send/ACK、資料庫寫入、恢復功能。
- Node 真 `node:sqlite :memory:`：實際 Auth 001/007/011/012/013、R16 本地租約及其他**三個分離的** Billing/Task/digest SQLite DatabaseSync（只做離線參考）；負測含錯來源、不同 env、失效 lease、撤銷 Session 恢復、未提交刪帳、保留政策、跨 DB 異動。沒有新增 Schema migration，AI-0 38 SQL DRAFT 清單維持不變。

## AI-2 / AI-4 交接與未解缺件
AI-2 Billing 不得以 raw Auth ID、無金鑰 hash 或 Store refund ID 假冒 Auth 事件；AI-4 只能在本機使用唯讀 review 結果安排後續測試，不得標記 Queue ACK、DLQ 完成或第二 Publisher。需 AI-0 + 業主另外裁決：#87 A/B 實體跨庫權威、合法 Q104/Q119 保存及撤回、KMS/HMAC issuer/輪替/證據保護、唯一 signed P05 Event、rollback-proof external floor/Store 官方證明、真 D1/Queue/Store/EAS/成本與簽核。**G00–G10 全 11/11 BLOCKED，P05/PUBLISHABLE=false**；不 main merge、Preview/Staging/Production 部署、真 DB/R2/Queue/Secrets/OAuth/Store/EAS、金流或付費；H-Global 停工、免費 Battery 永遠免費。
