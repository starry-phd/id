# AI-1 R17｜Auth 刪帳租約二次重驗（唯讀、離線候選）
**固定來源**：AI-0 R15 四 Owner 同版 Draft #112 SHA `e9b4a9e244342bfc2725b1daafca21dbb35ff8ad`；AI-1 R16 Draft #113 SHA `6efc94f18293ecea93dd35ed912ae044a0fb47ac`；開發 SOP #70；跨 D1 ADR #87 尚未決議。

已完成 R16 源端刪帳 outbox/CAS claim，但曾經 WeakSet 封存的 claim 仍可過期或被新 lease token+attempt 取代。R17 新增 default-OFF 的 `round17-auth-lease-fence.ts`，只接受來源真正封存 claim，且先驗合法用途、Starry development/staging scope、可信 server time；唯讀驗 Auth **原始出庫事件、已核銷 Challenge、Member deleted/去識別、全部 Session 已撤權、目前 lease token+attempt 未過期**。中間經 R15 Auth source 現況驗證後再次查 lease，禁止租約被取代後重用。提供真 `node:sqlite` Auth+獨立收件庫 memory tests，驗過期、重試、假 claim、非法目的、跨品牌/環境、會員復活、來源更改、並行舊 lease；無收件寫入、無 ACK。

**嚴格無權限**：輸出僅 `offline_current_lease_observation_only`；永遠 `may_ack_queue=false, may_mark_delivered=false, may_regrant=false, live=false`，沒有 send/publish/ack。此唯讀比較不是線性化的跨庫提交或可信可轉移 attestation；正式 P05 唯一 Publisher、法律 Q104/Q119、R16 lease 真 D1 migration、Queue/DLQ/ACK、非回退存證及 #87 方案須由 AI-0 核准。SQL inventory 38 DRAFT 未修改；G00–G10 11/11 BLOCKED。

AI-4 可引用此負向 fence test 作離線運輸規格參考，AI-3 Battery 與 AI-2 Billing 仍各自獨立唯一資料寫入者。沒有 main merge、Preview/Staging/Production、真 Cloudflare/D1/OAuth/Store/EAS/Secrets/付費或 H-Global 工作。
