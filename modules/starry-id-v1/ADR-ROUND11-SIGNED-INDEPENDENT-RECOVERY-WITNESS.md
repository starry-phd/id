# AI-1 R11｜Q116 獨立簽章見證核驗與反重播安全契約

## 固定來源
[AI-0 Issue #1 R10 實際驗收](https://github.com/starry-phd/id/issues/1#issuecomment-6436888725)、[R10 同版整合 PR #82](https://github.com/starry-phd/id/pull/82) 固定基準 \`f1eb5f0655cfdf8c9648ff6d004deed980fbc5d7\`、[#70 GitHub SOP](https://github.com/starry-phd/id/pull/70)、[AI-1 R10 原始 #79](https://github.com/starry-phd/id/pull/79)、[AI-3 復原 #74](https://github.com/starry-phd/id/pull/74)、[AI-4 逐筆恢復 #77](https://github.com/starry-phd/id/pull/77)。

## 本輪真實程式
- \`src/round11-signed-recovery-witness.ts\`：R10 原本 \`verifyIndependentAttestation\` 只有可信後端函式形狀、本輪新增真正執行 **WebCrypto RSA-2048+ RS256 非可匯出公鑰簽章驗證**。使用固定 \`key_id\`、只允許 Starry development/staging、明確版本化 canonical JSON（品牌、環境、獨立見證來源、引用、高水位三項 counter、序列號、觀測時點），嚴格資料描述子/原型/額外欄位驗證與 base64url canonical。任何 payload 竄改、偽造 signer、錯位 App／環境、錯金鑰、bad signature，直接 fail-closed。
- 同步要求從**受保護、非原 Auth D1/備份**的後端獨立單調 Head 取得 \`sequence,witness_ref,signature_sha256\`，並與成功驗證的已簽見證完整比對。舊但仍在 30 秒新鮮期內的合法簽章，只要外部最新 sequence 前進也不得重播。Head 的不可回退/鑑別真實性仍仰賴 AI-0 核准的受信 backend、實體隔離／key rotation／防撤回設計；此 PR 沒有建立 production HSM/KMS/R2/Durable Object。
- \`verifyIndependentAttestation\` 接口**實際整合 R10 的** \`createOfflineStarryRecoveryFenceAuthority\`：先 Privacy Gate、非同 DB 的獨立證據＋RSA 簽章及最新 Head，再核對本地 D1 三 fence。通過也 **只能 review_only / may_restore=false**。真 AI-3 剩餘四個 fence 不由 AI-1 宣稱實作；跨庫時間一致性/交易鎖仍不成立。
- \`test/round11-signed-recovery-witness.test.mjs\` 真用 WebCrypto \`subtle.generateKey/sign/verify/digest\`，負測假簽章/舊 seq/Key/不同作用域/tamper/不安全 getter/Proxy，且串接 R10 判 \`review_only\`；\`test/test_round11_independent_witness.py\` 用**兩個真正獨立但非持久的 SQLite memory connections**重現 Auth DB rollback 不會同時倒退另一份 RAM Anchor，並明確證明其重啟後會丟失、不是實際不可回退證據。
- **全部預設 OFF，沒有外部密鑰、真資料庫／Cloudflare PITR/R2、EAS/Store/Worker 部署、付費**；H-Global 繼續暫停。

## AI-0／AI-3／AI-4 Remaining BLOCKED
- AI-0：真正具有防重播且與受審 Auth D1 物理／權限隔離的獨立高水位服務，簽章產製與輪替、來源存取權、PITR／R2 相互一致性、法律保留、成本上限及災難演練需要獨立業主審核；無法由 30 秒 stamp / HMAC 假件代替。
- AI-3：七域中的 \`deleted_members,revoke_sessions,claimed_registration_gifts\` 中前三份 Auth 交 AI-1；另四份 Battery/Task/Billing/Audit 應有自己的不可回退權威。Q119 keyed pseudonym 仍可能是個資，法定保留/擦除例外未核准；不能恢復已刪帳會員、舊 Session 或重新贈送 X。
- AI-4：不得把這份 \`review_only\` 簽章驗證當作現行 Login Principal 或真 Task/Battery 發放允許；必須在真正寫入當下再驗 ACTIVE Member/AuthVersion 與單一受信交易界限。跨 D1 原子性和官方 OAuth/Store 都未驗。
- Release G00～G10 11/11 BLOCKED，P05 不可發布，**無 main merge、Preview/Staging/Production、live DB/R2/Queue/Secrets、EAS、IAP 或付費操作**。
