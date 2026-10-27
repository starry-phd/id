# AI-1 R16｜Auth 單一刪帳事件發布者候選與持久租約（未核准正式發布）

## 可稽核基準
AI-0 [Issue #1 R15 整合驗收](https://github.com/starry-phd/id/issues/1#issuecomment-6439591695)、[整合 PR #112](https://github.com/starry-phd/id/pull/112) 固定 \`e9b4a9e244342bfc2725b1daafca21dbb35ff8ad\`、[開發 SOP #70](https://github.com/starry-phd/id/pull/70)、[跨 D1 ADR #87](https://github.com/starry-phd/id/pull/87)。這是 AI-1 Auth Owner 的原始碼候選，**AI-0 未核定正式唯一 publisher／P05**。

## R16 真實新增
- \`src/round16-canonical-deletion-publisher.ts\`：**預設 OFF**、Starry dev/staging only。提出唯一 Auth-owned publisher 識別 \`starry-auth-sole-v1\`（**候選命名，非業主批准**）。先透過既有 R15 \`readBatteryEvent\` 當次合法目的、已提交 Auth outbox/current deleted Member/所有 Session 已撤銷等權威查驗，使用 WebCrypto CSPRNG 產 256-bit lease token。
- 只用一條 SQLite \`INSERT...SELECT ON CONFLICT DO UPDATE ... RETURNING\` 取得同 Auth DB 的**單一 source event 租約**：直接 JOIN 原始 \`starry_deletion_outbox + starry_members + consumed deletion challenge + challenge scope\`，校驗 \`environment\`、原始會員 \`auth_version=old+1\`、去識別資料、全 Session revoke、原事件時間、AI-3 可接受會員 ID 長度。事件已有未過期租約 => 本次 0 row；到期可用**不同租約 token**接手且 attempt_no 單調增加，上限 1000，永遠同一 immutable \`event_id\`。領到租約後再 R15 權威重查一次（競態時 fail-closed、租約自然逾時）。
- 只回 WeakSet sealed \`offline_claim_only\`，輸出 AI-3 已存在四欄最小事件與 lease metadata；\`may_ack_queue=false\`、\`may_mark_delivered=false\`、\`may_regrant=false\`、\`live=false\`。**不提供** \`send/publish/ack/markDelivered\` API。**不宣稱跨 DB 原子、真正 Queue 送達或「exactly once delivery」**。
- **避免偷渡未審 SQL**：\`test/fixtures/round16_auth_dispatch_lease.DRAFT.sql\` 為 *disposable SQLite memory 專用* 源端租約表／單一 publisher CHECK/UNIQUE token/不允許回退，**並不是** \`schema/\` 下新正式 migration，AI-0 R15 已核 38 個 SQL Draft 清單仍不更動。真的要部署 schema 必須另外先交 AI-0 進行來源 Git Blob/SQL inventory/法律/回復審核。
- \`test/round16-canonical-deletion-publisher.test.mjs\`：Node 測 default OFF、偽造 scope/事件、沒合法批准時 0 DB、Crypto 隨機租約、單一 SQL、重新查驗/後端失效、無 ACK 方法。
- \`test/test_round16_canonical_publisher.py\`：真**兩個彼此隔離 SQLite memory DB**，Auth 套用 001/007/011/012/013 加僅離線租約 fixture，真正 one-use 刪帳/全部 Session revoke/immutable outbox/原子租約；另一個 sink 的 UNIQUE(event_id) Inbox 模擬事件送出成功而來源 crash、租約逾時**至少一次重送**，Sink **只執行一次** revoke；獨立 sink transaction rollback 不能讓 Auth 自動回滾，明確展示**不具跨 D1 原子性**。這是隔離重播測試，非聲稱已串上 AI-3 真 Battery Trigger（AI-4 R15 已有該測試）。
- AI-3 與 AI-4 目前另外兩套 mapper／relay 必須保留 OFF、不能把三者同時當 Publisher。AI-0 需決策唯一責任（Auth 負責 outbox/claim、AI-4 負責 transport、AI-3 負責 inbox/dedup）並批准正式事件 DTO/授權／持久重試、DLQ、Queue ACK。AI-2 的 HMAC 對應仍需合法 Q104/Q119/金鑰與 Canonical P05，沒有任何假摘要／fake Store Auth。

## 實際安全限制
本輪只是**同 Auth DB 租約與跨庫重試＋Sink 去重的候選設計**。外部來源身份完整性/簽章、租約伺服器可信時鐘、真 Cloudflare D1 transaction compatibility、跨服務 Saga/單權威、非回退存證、資料保留/Q104/Q119 與 KMS、所有真 D1/R2/Queues／OAuth/Store/EAS/付費仍不具驗證。
正式 G00–G10 **11/11 BLOCKED**、P05 PUBLISHABLE=false；不合併、不 Preview/Staging/Production、不操作真 DB/Secrets/Queue/Store/EAS、不付費、H-Global 持續停工。
