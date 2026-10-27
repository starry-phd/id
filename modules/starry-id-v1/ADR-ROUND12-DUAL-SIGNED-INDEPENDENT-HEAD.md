# AI-1 R12｜雙金鑰認證 Auth 復原 Head（離線候選）

## 已核准來源
AI-0 最新 [Issue #1](https://github.com/starry-phd/id/issues/1#issuecomment-6437271393)、[R11 同版本整合 Draft PR #88](https://github.com/starry-phd/id/pull/88) 固定 HEAD \`fa85b9ad9a2354ed4e9a19538c269cf232c803eb\`、[#70 開發 SOP](https://github.com/starry-phd/id/pull/70)、AI-1 R11 [#84](https://github.com/starry-phd/id/pull/84)，AI-3 R11 Q116 [#86](https://github.com/starry-phd/id/pull/86)，AI-4 R11 durable ACK [#83](https://github.com/starry-phd/id/pull/83)，以及 [AI-0 #87 跨 D1 架構候選](https://github.com/starry-phd/id/pull/87)。

## R12 新增可執行安全介面
\`src/round12-signed-head.ts\` 增加**第二把獨立的 RSA-2048+ WebCrypto RS256 pinned 公鑰**，針對 R11 原本只透過可信 Backend Port 輸入的 \`sequence,witness_ref,signature_sha256\` 高水位 Head，額外驗證版本化的**Starry/環境／來源／Sequence／前一層 witness Signature SHA256／期限／key_id** 完整簽章。Head 必須 30 秒以內（嚴格先看可信後端現在時間）、保持獨立 head signer ID 不等於原 R11 witness signer ID、Canonical Bytes 與 Base64URL 皆正規；getter／revoked Proxy／外來鍵、偽造 Head、跨品牌、過時/超時、錯 key 均拒絕。

- Head 通過才產生縮減的 \`{sequence,witness_ref,signature_sha256}\` 給 **既存** R11 \`readIndependentHead\`，R11 仍驗自己的簽章及 digest，R10 仍有每次 Privacy Gate + Starry 身分事件 fence 對比。任何一項拒絕，整體拒絕；**唯一成功輸出始終為 \`review_only,may_restore:false\`**。
- \`test/round12-signed-head.test.mjs\` 真生成**兩對不同 RSA keypair**、兩次獨立 WebCrypto 簽名，測真實三層鏈 R12 → R11 → R10；惡意改值、不同 signer、失效/錯誤/未及時更新、不同品牌、簽章重播等正反測，並非僅依假 \`signatureValid:true\`。
- **限制很重要**：被正確簽名的舊 Head 在有效期限內仍能被重播（如果根本沒有真正獨立的當下不可回退 Head Storage）。本 PR **沒有**建立硬體安全模組、真實遠端單調 Ledger/KMS、抗回滾非同步外部一致性、簽章私鑰發行/輪替、真 PITR/跨 D1 Transaction，也**不能**把兩把 key_id 不同當成硬體金鑰物理隔離的已驗事實。必須由 AI-0 正式決策可信站外權威架構，AI-3 驗其七域其他四域的原子一致性，AI-4 作真正 Task→Wallet ACK fencing。
- Q104 撤回/跨域隱私、Q119 首贈身份最小化、Retention 與刪帳權仍 Privacy Gate PENDING，不增任何原始 OAuth subject、Email、Session Token。Starry Battery 永久免費，不啟用 X/Y 額度或真首次贈送。
- 全部 R12 實作僅 \`modules/starry-id-v1/**\`，沒有 User-facing API/Store/Worker。**正式 G00～G10 11/11 BLOCKED**、\`PUBLISHABLE=false\`；不合併 main、不部署 Cloudflare/EAS、不操作真 DB/Secrets/金流、不付費，H-Global 繼續暫停。
