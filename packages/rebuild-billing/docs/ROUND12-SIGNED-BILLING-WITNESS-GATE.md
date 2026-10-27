# AI-2 R12｜Q116 Billing 獨立見證 RS256 真簽章防重播（離線）

基線：[AI-0 R11 整合 Draft #88](https://github.com/starry-phd/id/pull/88) `fa85b9ad9a2354ed4e9a19538c269cf232c803eb`；依 [#70 SOP](https://github.com/starry-phd/id/pull/70) 實作，僅修改 `packages/rebuild-billing/**`。

新增 `src/signed-billing-witness.ts`：使用 WebCrypto 的 **RSA RS256 2048bit+ 公鑰**驗證 Billing outbox 獨立見證，pin 公鑰必須不能匯出；固定 canonical payload 包含品牌、環境、獨立 witness ref、時間、帳本連續 sequence、逐筆事件 SHA256 head digest、key ID。非正規 Base64URL、異常 getter/Proxy、偽造事件、錯環境與 key_id 均拒絕。簽章通過後再從**不同權威**讀取最新高水位 `sequence/witness_ref/signature_sha256` 並要求後端驗真，讀取兩次以降低並行前進重播；結果只回 boolean 給現有 R11 Q116 `verifyIndependentAttestation` port。新 Node22 負測使用真 ephemeral RSA KeyPair 的 sign/verify，以及現有 R11 SQLite-memory Billing 逐筆退款事件鏈的**真跨程式整合**。

**明確限制**：目前沒有真正外部不可回退的最新 Head 權威、HSM、密鑰生命週期、雙金鑰輪替、正式 D1/PITR/R2、Store Apple/Google 權威事件或安全簽章發行者；測試的後端 callback `verifyProtectedHead=true` 不是正式的受保護錨點。兩次 head read 不能取代可序列化跨庫讀寫。沒有新增公開 Worker/SDK API、也不產生付款或任何 Entitlement。

**G00～G10 11/11 BLOCKED**、`BILLING_SIGNED_WITNESS_LIVE_ENABLED=false`、原 Billing restore/P05/Commerce 禁發布。H-Global 暫停，Battery 永遠免費。不得 Merge main、部署、操作真 DB/Secrets/Store/付費。
