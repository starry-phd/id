# AI-2 R13｜Billing Q116 雙獨立 RS256 簽章高水位與完整退款防復活

以 AI-0 R12 已驗收整合 [Draft PR #94](https://github.com/starry-phd/id/pull/94) HEAD `4a11b387d32aba789c905e03291f3bc18ebd71d6` 為唯一基準，依 [#70 開發 SOP](https://github.com/starry-phd/id/pull/70) 本輪僅新增 AI-2 的 3 個檔案。

R11 Billing Outbox SHA256 退款鏈、R12 Witness RSA 驗簽已存在，**不重作**。R13 新增 `src/signed-billing-head.ts`，對最新受保護 Head (seq/witness_ref/Witness 簽章 digest) 以**第二把 RSA-2048+ 非可匯出公鑰**驗 RS256；Head 與 Witness 必須使用不同 key ID、固定 canonical Payload `version,brand_id,environment,source,sequence,witness_ref,signature_sha256,issued_at_sec,expires_at_sec,key_id`，要求伺服端時鐘及不超過 30 秒有效窗。拒絕外來 Brand/Env、未列鍵、非正規 Base64URL、getter/Proxy、錯簽章、回退序號與竄改簽署資訊。R12 兩次讀 Head，每次 `verifyProtectedHead` 強制重新讀取並驗真，不以布林測試假冒密碼學驗簽。新離線 Node 測試採**兩組獨立真 WebCrypto RSA KeyPair**，負測＋串接 R13→R12→R11 真 SQLite `:memory:` REFUNDED 資料。

安全限制：簽名本身**不保證**真實受保護 Head 的**物理不可回退**；有效期內完整一組已簽章 Head 仍可能遭同庫重播、時鐘可能偏移。未有真不可回退外部持久 Anchor/金鑰簽發管理/時鐘信任、跨 D1 同交易與 Q104/Q119 法遵、Store 官方交易/OAuth/JWS、D1/P05/Queue/Cron/EAS/成本正式 Gate。所有服務 port 均為 offline injection，無 live signer 或真 Store。

**G00–G10 11/11 BLOCKED，`BILLING_SIGNED_HEAD_LIVE_ENABLED=false`，`BILLING_SIGNED_HEAD_RESTORE_ALLOWED=false`，免費 Starry Battery 不可轉成付費 SKU。H-Global 暫停。不合併 main、不部署、絕不真 D1/Queue/Secrets/Store/EAS 或付費。**
