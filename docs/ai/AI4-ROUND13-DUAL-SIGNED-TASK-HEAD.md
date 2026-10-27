# AI-4 R13｜已提交 Task 與獨立 Head **雙 RSA 簽章**／時序驗證（OFFLINE）

依最新 [AI-0 R12 四 Owner verified #94](https://github.com/starry-phd/id/pull/94) `4a11b387d32aba789c905e03291f3bc18ebd71d6`（3/3 GitHub Actions success）、[#93 stack audit](https://github.com/starry-phd/id/pull/93) 及 [#70 SOP](https://github.com/starry-phd/id/pull/70) 開發。Issue #1/#5 明確要求續補真正來源而非重做 R12 Task RS256、R11 ACK/AI-3 七域復原或 AI-1 Auth R12 雙金鑰。

**新增 Task-specific 能力**：`apps/api/src/round13-dual-signed-task-head.ts` 使用另一把 nonextractable pinned RS256 public key，驗證 Starry-only `independent_protected_head` 的 `task_ref/member_ref/sequence/proof_revision/signature_sha256/issued_ms/expires_ms/key_id` 獨立 canonical 簽章，30 秒內短效有效窗，head signer ID 必須與 R12 Task signer ID 不同。**真實呼叫 R12 `createOfflineSignedTaskVerifier`** 驗提交的 Task 完整結果/價格/版本，並在完成驗簽後**重新讀取並驗簽** Head，若序號、簽名或其他 Head 欄位在前後改變則拒絕；以獨立 per-request closure 避免併發驗簽互相污染。

**測試**：Node ephemeral 獨立雙 RSA keypair 的真 sign/verify，10 項，包括雙簽有效、篡改 Head／換序列/費率、兩份各自真簽名但 Head 在中途前進而拒絕、跨品牌／過期／非 canonical 資料、getter/revoked Proxy、Disabled/outage、R11 Queue ACK 真模組負測；**另外包含刻意證明的剩餘漏洞測試**：若完整舊 Task＋舊 Head 同時重播，離線數位簽章單獨無法偵測，必須依賴真外部不可回退單調權威。測試私鑰僅 CI 臨時產生，不是商用簽發。

**嚴格界線**：本輪沒有託管的真外部不可回退 Head／KMS／金鑰輪替、可信 Clock、真正 Task issuer、跨 AI-1 Session/Auth/D1/AI-3 Wallet 的原子寫入、Q119 合法贈送或 Cloudflare 真 Queue ACK。測試簽章與注入介面不能用來發放 Battery、恢復會員、授權任何 Store／Worker。需 AI-0 另選跨庫架構且取得法遵、預算、正式環境核准，AI-3 的 Wallet journal 和 AI-1 Session 撤權亦需真實權威。所有正式 **G00–G10 11/11 BLOCKED**，`DUAL_SIGNED_TASK_HEAD_LIVE=false`，P05 禁發布。不合併 main、不部署、不用真 D1/R2/Queue/Secrets/Store/EAS、無付費，H-Global 暫停。
