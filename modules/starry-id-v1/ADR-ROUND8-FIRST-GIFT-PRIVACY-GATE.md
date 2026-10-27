# AI-1 R8｜Q119 身分防重領：隱私 Gate 與跨 App 刪帳撤銷

**基準**：AI-0 綜合 [#64](https://github.com/starry-phd/id/pull/64) \`e7ccf86483f1ea5515ac31b227f710d292289b4d\`，R8 需求核對 [#65](https://github.com/starry-phd/id/pull/65) \`2d089cf58bfcd8e0e6c785ee4dba773e3db09db0\`。正式 Q88=A、Q97=A、Q119=A、Q117=A；GitHub Issue #1/#2/#3/#4/#5 交接，非真實服務授權。

## 新的可執行實作與限制
- \`src/round8-first-gift-guard.ts\`: **預設關閉**，僅 server-controlled Starry development/staging；在每次評估前執行 \`privacyApprovedNow\`，不核准時不查原始 \`provider/sub\`、不計算 HMAC、不查庫。只接受 AI-1 既有 WeakSet 封裝 \`TrustedPrincipal\`，查現在最新 ACTIVE Member/auth_version，再由 Starry ID 後端查真正 canonical Apple/Google subject；從不接受 client \`verified\` / email / birthdate / s_user_id 當信任根。使用不可匯出 256+ bit HMAC-SHA256 key，針對 Starry + 一次贈送目的 + 環境 + stable provider/sub 產生固定 pseudonym；**不含 app_id**，所以跨 Starry App 同一身分生成相同鍵。D1-shaped port 只有**讀取** pseudonym 是否已領取，結果 \`ALREADY_CLAIMED\` / \`BLOCKED\` / \`UNCLAIMED_NOT_AUTHORIZED_TO_GRANT\`。後者只附 WeakSet 封裝內部證據，**不是可兌領 Battery 的允許證明**。沒有任何真正贈送、費率、X/Y、刪帳資料複製。
- \`schema/008_starry_first_gift_privacy.UP.DRAFT.sql\` + \`DOWN.DRAFT.sql\`: 在 \`:memory:\` 測試 minimal fingerprint/版本/時間唯一鍵，無 raw OAuth sub/email、無可恢復已刪帳 user id；真正 Cloudflare D1 表、保留期限、資料主體撤回/刪除例外、HMAC key rotation 仍 **Privacy Gate BLOCKED**。此表中的 HMAC 值仍是可識別用途的*個資*，絕不能因沒有明文而宣稱匿名化。
- \`round7-deletion.ts\` 修復競賽：只有 member 已被本次版本 CAS 更新至 \`deleted\` 且版本與 server time 相符，才可撤銷該帳號所有 Starry Apps 的 sessions，避免在失敗／舊版 CAS 下無條件撤銷其它 Session。仍需真 Cloudflare D1 \`batch\` 原子性與跨資源 outbox delivery Gate。
- Q97：新 Starry 帳號允許成立，但**不得回收舊 s_user_id、Session、Battery 或商店權益**。Q119 不等於可長期保存 OAuth 原文；在法定例外／刪帳及重註冊政策正式審核前，不開啟 first-gift issuance。AI-3 須在自己的 Battery **同一權威持久交易**做 uniqueness claim + append-only ledger，**不得先查一次 HMAC 未見過就直接發 X**，也不得重試時重發或無憑證清理去重紀錄。
- H-Global Auth/D1/個資完全獨立且繼續暫停；Q104 的一般跨系撤回合法權仍未決。本輪不動任何正式 API、Cloudflare、OAuth、Store、EAS、Secrets、付費資源。

**尚待 Gate**：合法性/地區適用/保留年限/擦除需求/防詐例外/可驗證資料主體權、Pepper rotation 與 HMAC key 管理、被刪帳會員重新註冊的 canonical provider 身分連結、單一原子跨服務發電池與身份建帳順序，Cloudflare D1 transaction/備份/復原、正式 Mobile、官方認證測試。G00–G10 11/11 BLOCKED、Battery live writes disabled、P05 Commerce 禁止發行。
