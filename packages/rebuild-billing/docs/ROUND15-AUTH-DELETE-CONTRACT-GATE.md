# AI-2 R15｜Q88 Auth→Billing 刪帳事件契約離線映射 Gate

基準：[AI-0 R14 四 Owner 驗收 #106](https://github.com/starry-phd/id/pull/106) SHA `dbb565895489cbe2a3b78eab7006ef0cdc48f01a`；SOP [#70](https://github.com/starry-phd/id/pull/70)。本輪只修改 `packages/rebuild-billing/**`。

**原始來源不可補造：**AI-1 R13 SQL `starry_deletion_outbox` 實際只有 `event_id,s_user_id,occurred_at,event_type`；沒有 Billing 所需 `auth_version,brand_id,environment,event_digest,event_ref,member_ref`。新增 `src/auth-deletion-contract.ts` 定義 candidate v1 轉接器：由受信、已提交且同一 Auth DB snapshot 讀取上述原始四欄和**當前** `starry_members(s_user_id,status,auth_version,updated_at)`。只在 current Member **確實 deleted**、timestamp 權威一致且由 server Port `verifyCommittedSnapshot` 驗真後，利用**不可匯出的 256-bit HMAC-SHA256 金鑰**與 Starry 環境/domain separation 推導 opaque `m_...` 會員代碼、`r_...` 事件參照及 64-hex 事件驗證摘要。這是**標示為推導出的 Billing 候選契約**，不是 Auth 原 SQL 已輸出的簽章、官方 P05/Store 事件，也不是業主批准的會員 HMAC 保留規則。

執行順序：Q104/Q119 合法用途先行 → Auth committed snapshot/可信來源證據 → scoped keyed-derived identifiers → 既有 R14 Billing Tombstone Consumer 再次驗 Privacy、重新讀並驗 Auth snapshot 兩次以拒絕刪除狀態/Version 中途變動 → **同一 Billing SQLite DRAFT DB** UPSERT tombstone/觸發器撤銷候選權益。失敗只返回 blocked、`may_ack=false,may_grant=false`。真兩個獨立 SQLite `:memory:` 連線測試原 Auth 四欄對應、版本中途變更/法律/格式/權威缺失、密鑰範圍、不復活、重播與回滾；不重寫既有 R14 SQL。

**尚未獲准／仍 BLOCKED：**真跨 D1 Auth 的 committed 同時點一致讀／獨立可驗簽的來源權威與密鑰供應／有效時鐘／HMAC 隱私保留、正式 canonical P05 schema 及其持久 Queue→D1→ACK、Auth/Billing 兩個 D1 的真正交易 atomicity、更新者刪帳後重新註冊、不同中心系統更動、Store Apple/Google 原廠簽章和訂閱退款權限、PITR 不可回退 Anchor、真 D1 triggers/成本、EAS、法遵 Q104/Q119。**當前 backend `verifyCommittedSnapshot` 為僅離線注入的測試回呼，不可冒充真數位簽章。**

G00–G10 **11/11 BLOCKED**、`LIVE_AUTH_BILLING_DELETE_BRIDGE_ENABLED=false`、`BILLING_DELETE_CONTRACT_PUBLISHABLE=false`、Starry Battery 永遠免費、H-Global 暫停。未合併 main、未部署、未動真 D1/Secrets/Store/EAS 或付費。
