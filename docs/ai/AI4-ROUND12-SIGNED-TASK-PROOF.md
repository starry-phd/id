# AI-4 R12｜已提交 AI 任務的 RS256 真驗簽＋獨立防重播 Head（離線）

**基線**：AI-0 最新 R11 四 Owner 真整合 [Draft #88](https://github.com/starry-phd/id/pull/88)，SHA `fa85b9ad9a2354ed4e9a19538c269cf232c803eb`，其同 SHA 3/3 GitHub Actions success；包含 #87 ADR 和 #70 GitHub SOP。依 Issue #1/#5 及 AI-1/AI-3 跨域交接；**不重做** R8 Task field adapter、R9 Battery settlement candidate、R10 recover digest、R11 ACK retry、AI-1 Auth RSA witness。

**本輪真正增加**：`apps/api/src/round12-signed-task-proof.ts`（default OFF）。以 WebCrypto pinned、非可匯出的 2048+ RSASSA-PKCS1-v1_5/SHA-256 public key，核對 Starry 開發／staging、Task 全 14 欄、server committed succeeded/failed、member/app、policy/rate/price、proof revision、時間戳與 signature canonical bytes。先驗真正 RSA 簽章，再呼叫獨立「當下最新」server protected head，精確核對 task_ref/member_ref/sequence/proof_revision/SHA-256(signature) 防止**合法舊簽章**冒充最新任務。30 秒測試 freshness，錯來源、錯版、重放、簽名錯、accessor/Proxy/未知欄位或 trusted head 不可用全部拒絕。成功只返回供**後端**使用的 Task evidence，不簽發真 Wallet 授權。

`apps/api/test/round12-signed-task-proof.test.mjs` **10 項真 Node WebCrypto 測試**，使用測試臨時 RSA key 來簽署、verify，包含舊簽章與外部更新 head、篡改任務費率／結果／會員身分、非標準 base64url、backend outage、disabled 與 R11 Task ACK **真 import** 的拒 ACK 負測。私有 `apps/api/contracts/signed-task-proof.v1.DRAFT.json` 不增加公開 Worker、SDK endpoints。

**仍 BLOCKED**：真正 AI task 發行器及官方可信 server signer、server-protected head 的**外部不可回退持久權威**、正式金鑰簽署權與輪替、Secrets 管理、法定隱私、跨 D1 Auth Session/Wallet 原子結算與 Q119 gift、真 D1/Queue/Store/OAuth/EAS、Cloudflare staging 許可和成本。測試 RSA/private signer **僅生成於離線 CI**，絕非任何正式 key。符合簽章本身≠任務商用效力／SDK 授權的界線，`SIGNED_TASK_PROOF_LIVE=false`、G00～G10 11/11 BLOCKED、PUBLISHABLE=false。不合併 main、不部署、不動真 DB/Secret/Store/EAS/付費；H-Global 停止。
