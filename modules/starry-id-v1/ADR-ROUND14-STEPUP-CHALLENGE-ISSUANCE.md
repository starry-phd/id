# AI-1 R14｜後端二次驗證綁定與一次性刪帳挑戰簽發

依據 [AI-0 R13 Verified Draft #100](https://github.com/starry-phd/id/pull/100) HEAD \`dc798cacea55cc376ed993876c0971035353d688\`，Issue #1 [R14 指示](https://github.com/starry-phd/id/issues/1#issuecomment-6438501095)，[#70 SOP](https://github.com/starry-phd/id/pull/70) 及 AI-1 R13 [#98](https://github.com/starry-phd/id/pull/98)。

## 新 R14 實作（真正寫程式，離線測試）
- \`src/round14-stepup-issuance.ts\` 新增預設 OFF 的 Starry-only \`createOfflineDeletionChallengeIssuer\`。僅接受既有 AI-1 WeakSet \`TrustedPrincipal\`、目前 ACTIVE Member/AuthVersion、當下同 App/env/unrevoked Session，且後端現存 Session 的 Passkey/TOTP step_up_method/verified_at/expires_at **5 分鐘有效**。產生使用 WebCrypto CSPRNG \`crypto.getRandomValues\` 的 32-byte/256-bit \`challenge_ref\` 和獨立 32-byte event_id；120 秒內且不超過 Session 及 Step-up 的 TTL。原子 \`INSERT...SELECT\` 再次查真正同一 Auth SQLite Member/Session/Step-up；只有 DB 實際插入一列後，才透過原 \`createDeletionChallengeVerifier\` 的 WeakSet 簽發可供 R13 one-use 消耗的伺服器內部證據。沒有原始 Passkey/TOTP/Provider-sub/Email/Token 被儲存。
- \`schema/012_starry_stepup_challenge_scope.UP/DOWN.DRAFT.sql\`：SQLite :memory: 專用，R13 表的旁路 \`starry_deletion_challenge_scope\` 做 \`challenge_ref\`→app/env/stepup method+timestamp 綁定。DB triggers 在 challenge INSERT 時檢查當前活躍 Session 的 Step-up／expiry，拒絕同 user/session 並行未過期第二張 challenge；在 R13 消耗時核 issued App/env 與當前 Session 完全相符、原 Step-up timestamp 未被替換、仍在 5 分鐘內且有效。缺 attestation 舊 row **fail closed**。任一步驟錯誤 rollback，R13 原本 Member delete/AuthVersion/all Starry Session revoke/minimal outbox one-statement atomic trigger 保留。
- Node 實測 CSPRNG 格式與 WeakSet→R13 可消耗、scope/time/role/DB fault；真 SQLite :memory: 驗 Step-up 失效、App 改變、重放、第二張 active challenge、事件碰撞完整回滾及 migration inverse。

## 正式 BLOCKED / 跨 AI Gate
- **沒有實作官方 Passkey/TOTP 本身、秘密金鑰管理、目前手機／電腦的實際強認證**。本設計依賴先前由後端驗真的 Session Step-up 狀態；只證明這個資料庫狀態被綁定到一次性刪帳。獨立真正 verifier、強制用戶互動、Session 綁定、時間同步與合法稽核需 AI-0/AI-4 正式驗收。
- 只有同一 Starry Auth D1 內的 \`011+012\` SQLite 原子性被**離線**實測；真 Cloudflare D1 transaction/trigger 同時點驗收仍缺；跨不同 D1 的 AI-3 Battery/AI-4 Task、Q88 刪帳通知送達、Q119 first-gift claim 合法性與 Q104 隱私撤回尚未裁定。禁止拿這個 challenge 當 Task／Battery entitlement。
- legacy R7 deletion route 與不受此 \`012\` 約束的內部 migration 應保持 disabled；production 暫不得對外提供 issuance 或 consume API。
- G00～G10 **11/11 BLOCKED**、P05 \`PUBLISHABLE=false\`、H-Global 停工；不合併 main、不真實 Cloudflare/Store/EAS/金流、不操作付費資源。
