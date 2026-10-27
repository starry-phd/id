# AI-1 R10｜Auth 三域防復活 Fence：交接 AI-3 Q116、AI-4 Q88

來源：AI-0 [R9 Verified Draft #76](https://github.com/starry-phd/id/pull/76) 固定 \`e5a3ba76695316b3eaeb218fb0edd901d8820931\`；[#70 GitHub SOP](https://github.com/starry-phd/id/pull/70)、[Issue #1 整合驗收](https://github.com/starry-phd/id/issues/1#issuecomment-6436263332)、[AI-3 Q116](https://github.com/starry-phd/id/pull/74)、[AI-4 Q88 Task](https://github.com/starry-phd/id/pull/72)。

## 真正實作（DRAFT、離線）
- \`schema/010_starry_recovery_auth_fences.UP/DOWN.DRAFT.sql\`：在 Starry 自己的邏輯 D1-shaped SQLite 表，以交易內 trigger 單調累計 **deleted_members／revoked_sessions／claimed_registration_gifts** 事件次數，啟用時依既有會員刪帳／撤銷 Session／Q119 最初免費 Battery claims 數量建立初始值；之後每個新的正式狀態轉移只記一次（同樣 SQL UPDATE 不重複），同一 DB rollback 不會留下虛假的已提交 fence，禁止直接倒轉計數／刪除 row；DOWN 只限可拋棄的 \`:memory:\`，絕不能未經 AI-0 授權用於 live D1。
- **重要限制**：三個 fence 與原始會員資料存在同一 DB，若整個 PITR 回復到舊快照，**fence 本身也會倒退**，不能誤稱可自行擋住回復。這點在真 SQLite 測試中特別重現。需要另外的、不與原 D1 一起回退的**受保護 append-only 最高水位來源與真實獨立驗證**，包括法律保留、跨環境／多業務域校驗。
- \`src/round10-recovery-fences.ts\`：預設關閉、僅 Starry dev/staging、唯讀 \`createOfflineStarryRecoveryFenceAuthority\`，必須每次先由後端批准合規的 review purpose；之後取得獨立、當前（30 秒內）、與備份庫分離的可信高水位見證，驗證其後端簽章／完整性和作用域，再以固定 prepared SQL 讀 Auth D1 本地 counter，逐項完全相同才回 \`review_only,may_restore:false\`。任何缺少 Privacy、見證、簽章、DB、不一致／陳舊，即 \`null\` fail closed，**永遠不返回 Restore 許可**。
- 向 AI-3 的 \`recovery-guard.ts\` 交付的只有**三個 Auth 身份 fence**；AI-3 仍須從 Battery/Task/Billing/Audit 各自獨立、真實權威取得其餘四個 fence，不能由 AI-1 伪造整個 7-domain \`readAuthoritativeFences\`。AI-3 才負責 Q116 PITR + 受保護獨立備份雙重驗證，以及恢復前逐項 reconciliation。跨 DB 先查後回復仍存在 race；需 AI-0 核准 fencing/transaction strategy。
- 向 AI-4 的 \`task-atomic-settlement.ts\` 交接：此 Restore fence 不是登入權威、不應被當作 Session Token、task proof、任務免費 Battery 發放允許。AI-1 \`round6-auth-d1-authority.ts\` 仍是 Starry 當前 Session＋\`auth_version\` 核權候選，正式 Task Transaction 必須在真正單一可信寫入界限內保證刪帳競賽不復活，跨 D1 非原子風險未解。
- 範圍：不保存 raw Apple/Google subject、token、Email／完整會員資料、不修改 H-Global Auth 或資料；Q119 keyed pseudonym 仍是可能的個資，Privacy/保留期限/Subject deletion exceptions 尚未核准；其它四域 fences 的權威／持久稽核與 metadata 信任根依 AI-3／AI-0。無真 D1/R2/Queue、簽章 witness infrastructure、Restore、IAP/EAS/Cloudflare deployment/付費。
- 正式 **G00～G10 11/11 BLOCKED**，P05 \`PUBLISHABLE=false\`。本 PR 無 main merge、Preview/Staging/Production、真 Secrets/DB/Store、EAS Build/Update 或付費。H-Global 繼續暫停。
