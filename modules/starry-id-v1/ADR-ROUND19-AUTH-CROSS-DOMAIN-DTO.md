# AI-1 R19｜Auth committed-source 跨域唯讀 DTO（Draft，非發布權威）

## GitHub 依據
AI-0 最新已驗四位同版 R18 整合 [Draft #131](https://github.com/starry-phd/id/pull/131)，固定 SHA `f006e90311b3fecedae0f7c75004c940adfacede`。依據 AI-1 專責 [Issue #2 R19 指派](https://github.com/starry-phd/id/issues/2#issuecomment-6446347752)、AI-0 [Issue #1](https://github.com/starry-phd/id/issues/1#issuecomment-6446363651)、[SOP #70](https://github.com/starry-phd/id/pull/70)、[ADR #87](https://github.com/starry-phd/id/pull/87)。R15～R18 已完成，不重做。

## 真正新增
- `src/round19-auth-cross-domain-dto.ts`：default-OFF、Starry dev/staging ONLY 的原始 Auth 已提交刪帳事件唯讀適配器。唯一接受 R16 真 WeakSet-sealed Auth lease claim 與同環境的 `battery` 或 `saga` reader，禁 Billing 直接取得 raw ID（合法 HMAC 映射還沒批准）。
- 三重政策檢核：最新刪帳合法目的、Q104/Q119 最低留存的明確核准、後端注入的政策修訂版。中間經 R18 現行 committed outbox/所有 Session 刪帳時已撤權/合法 Challenge 確認，再以 R15 原始 4 欄事件重讀，之後再次執行完整 R18 檢查與 Auth 重讀。政策修訂漂移、事件/會員/時間不符、憑證過期與來源偽造皆回 null。
- 成功**僅返回** `offline_untrusted_cross_domain_auth_projection`，其 `event` 精確四欄 `event_id, member_ref, occurred_at_sec, event_type`，另有 `auth_version,source_attempt_no,policy_revision` 與內部 `scope/reader` 註解。這不是簽名，也不是合法對外 member_ref；來源 raw ID 仍可能是個資，限真 SQLite 測試；**未建立正式 P05 event envelope**。
- `test/round19-auth-cross-domain-dto.test.mjs`：真 Auth 001/007/011/012/013 + 租約 fixture 的 Node/SQLite 測試，另開兩個彼此獨立的 Battery/Saga SQLite Memory DB 作跨域碰撞、重播、錯環境/假回執與禁止寫入之安全負測。每次正面觀察亦不得使用 ACK 或寫別家 DB。
- 沒有新增 SQL migration 或改原始 Auth outbox 四欄，AI-0 38 份舊 SQL Draft inventory 不變。

## 交接與剩餘 Gate
AI-3 Battery 繼續管理 Inbox/Wallet；AI-4 Saga/Task/transport 仍不能把此唯讀結果視為官方簽署、P05/Queue ACK 或會計提交。AI-2 Billing 不可把 raw `member_ref` 當作已核准之 Store 身份/HMAC。全部輸出 `may_publish=false,may_ack_queue=false,may_grant=false,may_restore=false,may_regrant=false,live=false`，不存在 send/publish/ack 等方法。

#87 跨 D1 A/B、唯一合法 Auth Publisher、Q104/Q119 目的/留存期限/KMS/輪替/HMAC、真正具獨立不可回退的簽章證據、PITR、真 Cloudflare/Store/EAS/Queue ACK/DLQ 均**未核准**；不能用此快照推定跨庫原子性或擁有權。G00～G10 全部 11/11 BLOCKED、P05/PUBLISHABLE=false。絕不合併 main／部署／真 D1/Secrets/Queue／金流或付費／H-Global 開發。
