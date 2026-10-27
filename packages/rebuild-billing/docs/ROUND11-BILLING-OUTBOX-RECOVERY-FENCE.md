# AI-2 R11｜Q116 Billing Outbox 獨立見證防復活 Gate

正式基準：[AI-0 R10 四 Owner 整合 #82](https://github.com/starry-phd/id/pull/82) 固定 `f1eb5f0655cfdf8c9648ff6d004deed980fbc5d7`。按 [AI-0 #70 CI/SOP](https://github.com/starry-phd/id/pull/70) 專責隔離 Git Tree 單批提交。

## 本輪實際交付
- 既有 R10 Q113 租約、Store 模擬對帳與 CAS 測試**保留不變**；此輪補 AI-1 #79／AI-3 #74／#81 明確交接的 **Q116「billing_outbox」恢復防復活**。R11 `src/recovery-outbox-fence.ts` 建立 read-only、預設 OFF 的 Starry dev/staging 專用離線稽核候選。
- **合法性優先**：privacy+recovery 同意／法律 hold 先檢查，未批准時完全不讀取外部 witness、Billing DB 或可關聯交易資料。
- **獨立新鮮見證**：後端注入的獨立 append-only 見證必須涵蓋環境、截至 30 秒內時間、連續 seq/high-watermark、由逐筆固定 canonical 欄位 SHA-256 建立的 head digest；後端另外驗證其真正的簽章／不可回退屬性，**目前只為離線 mock port、並無真 PKI 或不可變存儲**。
- **逐筆/重播防護**：不信任 snapshot row，拒絕跨 App/Battery 商品、重複/缺漏/Gap、變更來源事件、亂序 commit、退款/撤銷事件隱藏、過期證據、惡意 getter/Proxy；只核 source event digest（非真 Store signature），必須從序號 1 起完整且兩次 count 相同；超出 128 筆即阻止並要求分頁方案，**不可拿截斷頁當全部歷史**。
- `schema/0006_recovery_outbox_DRAFT.sql` 是**未套用**的 SQLite `:memory:` append-only candidate，含禁止 UPDATE/DELETE triggers；整個 D1 PITR 回退會同時回退 schema/event，故其本身**不是獨立不可回退見證**。
- 無論符合還是拒絕，都 **`may_restore=false`，成功僅 `review_only`**；不自動復活舊會員、授權、訂閱、退款付款、Battery、P05 或 ACK Queue。提供 AI-3 的僅為 **billing_outbox 单域已比對的 counter/evidence**，不能僭稱 AI-1 另三域／AI-4 Task 或 Audit 已核實。

## AI-0／AI-1／AI-3／AI-4 後續 Gate
AI-0 要審合法保留／Q104 Q119／第一款商品及 SKU／供應商、成本與商用開關；AI-1 的刪帳權限與 session anti-resurrection 需獨立復核；AI-3 Q116 其餘 6 fence domains 仍必須由各自不可回退權威核准，跨 D1 snapshot 無法只靠此單域完成；AI-4 安全後端擴展與受控 D1/Queue Cron 需正式新授權。須另外實作**真正 Store Apple/Google 驗證和可信 Billing outbox committed writer**，並驗證外部獨立簽章 witness、新鮮度、key rotation、分頁及刪除和 P05 恢復政策。本輪不操作實際 D1/Queue/Store/付費。

**正式 G00–G10 11/11 BLOCKED；`LIVE_BILLING_RECOVERY_ENABLED=false`；`BILLING_OUTBOX_RESTORE_ALLOWED=false`，P05/COMMERCE 不可發布，Starry Battery 永遠免費、H-Global 暫停。**
