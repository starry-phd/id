# AI-4 R10｜Task deep reconciliation × AI-3 Q116 isolated restore review（DRAFT）

**基準**：AI-0 R9 四組離線整合 [Draft #76](https://github.com/starry-phd/id/pull/76) 固定 SHA `e5a3ba76695316b3eaeb218fb0edd901d8820931`（3/3 GitHub CI SUCCESS，**不是**正式發布驗收）；包含 #70 SOP。來源 AI-3 Issue #4 → AI-4 Issue #5 (Q116、`committed_ai_tasks` fence) 及 AI-0 Issue #1 最近決議。

## 真正新增的 AI-4 程式

- `apps/api/src/task-recovery-integrity.ts`：只在 server-only offline composition 中以三個**獨立注入來源**（最新已提交 Task、PITR Task 來源、受保護備份 Task 來源）重算版本與 Starry/隔離環境 domain-separated canonical SHA-256。逐筆比對 10 欄，包括 Task/member/App/type、policy/rate/price 版本、proof revision、completed timestamp、success/failure；不只比 7 個高水位數字。最多 256 筆受控批次、排序且 reject duplicate/malformed/異常 object、Proxy/accessor/不一致/來源故障。全部內容一致後才呼叫受保護的**獨立外部 Anchor 驗證 port**（測試 fake 不具信任性），只能回 `review_only,may_restore:false`。
- `createOfflineTaskBoundRecovery` 與**實際 AI-3 R9 `assessIsolatedRestore`** 串接，逐筆 task 比對通過後仍須 Q116 真正兩個備份 proof、7-domain fence、法律 hold、操作員 Step-up、持久 review audit；任一失敗 BLOCKED，永不執行 Restore。
- 9 個 Node 安全負測：相同 count/high-watermark 但變更 Task 成功或身分/費率 → BLOCKED、刪一列/重複/偽欄位/accessor/被撤銷 Proxy、Anchor 失效、AI-3 legal hold/audit/highwatermark 漂移、外部權威故障等。
- 版本化內部 `apps/api/contracts/task-recovery.v0.DRAFT.json`；**不修改** Worker 健康路由、公開 OpenAPI、SDK exports、正式 Storage/Secrets 或 AI-1/2/3 Owner 程式。

## 待 AI-0/AI-1/AI-3 另行 Gate

SHA-256 **只能證明已讀快照內容相等**，無法證明來源可信、簽章或防舊版重播；外部 Protected Anchor 有 mock 驗證並**未對接真 Secrets/硬體保護／法定受控權威**。目前一次最多 256 筆，本輪不是大量資料恢復方案；之後需審隔離、分頁一致性、原子 snapshot、D1/PITR/R2 真備份簽章、Anchor nonrollback highwatermark、逐筆正式會計/Task replay、刪帳 Q88/Q119 個資去識別與 legal hold、成本/RPO/RTO/經核准演練。不得把測試 mock 或 AI-3 7 個數字一致當成 restore authorization。

**G00～G10 11/11 BLOCKED，`LIVE_TASK_RECOVERY_ENABLED=false`，AI-3 `RESTORE_MUTATION_ALLOWED=false`，P05 不發布**；沒有 main merge、Cloudflare Preview/Staging/Production、正式 D1/R2/Queues/Secrets/Store/EAS/金流或任何付費；H-Global 繼續暫停。
