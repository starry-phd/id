# AI-0｜R24 四 Owner + App Portfolio 同版整合與下一階段驗收決策（2026-10-28）

> **狀態：OFFLINE INTEGRATION CANDIDATE；絕非 LIVE READY 或獲准正式發布。** 以 [AI-0 上輪同版 #171](https://github.com/starry-phd/id/pull/171) 的固定 HEAD `2841011b9a32680d889c53062b659b15b1ac63e9` 作唯一基線，繼續現有中央 SBASE 與 Starry App 長期組合管理。不搬移/修改原始 Owner 檔、實體會員資料、H-Global 或正式部署設定。

## 1. 本輪真正完成與版本來源

| 負責 | 最新 Draft / 精確 SHA | 真正新成果 | 測試證據與不能宣稱 |
|---|---|---|---|
| **AI-1** | [#172](https://github.com/starry-phd/id/pull/172) `0e83fe7b31283a876a597809e42ddceff24d712a` | 4 個原始檔，從 Repo 官方 Gate/現有 Auth 程式實際掃描 G02-OIDC/G03-Session-D1；定位 staging D1、正式 Worker route/JWKS/PKCE 缺口，CLI 僅能 assert blocked | [完整 Gate #40639902049](https://github.com/starry-phd/id/actions/runs/40639902049)、[AI-1 #40639902047](https://github.com/starry-phd/id/actions/runs/40639902047) 離線成功；**舊 SHA `02581994...` 和舊 test blob 已被修正，不得匯入**；不代表真 OIDC/D1 |
| **AI-2** | [#174](https://github.com/starry-phd/id/pull/174) `29e0c3c396f27416a9682c8a56aac89228945797` | 3 個原始檔，WebCrypto RS256 驗證**合成公鑰**簽的 Google Pub/Sub 推送 JWT 與相同 App RTDN 結構，14 個安全案例 | [完整 Gate #40640008841](https://github.com/starry-phd/id/actions/runs/40640008841)、[AI-2 #40640008866](https://github.com/starry-phd/id/actions/runs/40640008866) 離線成功；**JWT 驗簽≠ Google 官方 JWKS 受信、RTDN≠ Play Developer API 正式購買/退款狀態、沒有 D1 durable/Grant** |
| **AI-3** | [#173](https://github.com/starry-phd/id/pull/173) `88b6628c476333e63999c434190121dfc52696b1` | 3 個原始檔、16 項隔離 staging D1/Queue/DLQ/ACK-after-commit/PITR chaos 驗收**可執行離線計畫**，`--execute` 保持禁用 | [完整 Gate #40639659732](https://github.com/starry-phd/id/actions/runs/40639659732) 成功；**不是已跑真 D1/Queue、沒核准跨 D1 模式或獨立 witness** |
| **AI-4** | [#175](https://github.com/starry-phd/id/pull/175) `01ef512d068d99f2fb2b8a5a2fefd6c2677113de` | 3 個原始檔，在`*.invalid` 合成起源把已核實 Signed Session+SQLite 身分驗證與 HTTP 204/401/404/503 防護語義接在一起，未暴露真路由 | [完整 Gate #40639877661](https://github.com/starry-phd/id/actions/runs/40639877661) 離線成功；**不是 Worker 網站、真 staging、iOS/Android Build 或 Cloudflare Preview 成功** |
| **AI-0** | [#176](https://github.com/starry-phd/id/pull/176) `afe126ea450d8bee049f33ecc22ae39249f3f1f1` | 5 個原始檔：產品開案、反重複/換皮上架、證據分數防冒充、12 個案例、讀取式 CLI | [完整 Gate #40640918204](https://github.com/starry-phd/id/actions/runs/40640918204) 離線成功；**0 真市場評分、0 新產品核准、0 真 App Factory/Native Build** |

**整合方法**：直接使用五份 PR 的**完整 18 個原始 Git Blob** 製作單一 Git Tree，繼承 #171 上一輪已驗 **16+18=34 個原始來源檔**，不重做或改寫程式碼。新增 [R24 原始 Blob 清冊](./r24-20261028-all-owner-original-blob-integration.v1.json) 與 [同 checkout Git Byte/Release 防護測試](../../packages/integration/test/r24-exact-owner-blob-and-release-boundary.test.mjs)，驗證本輪新 18 個與上輪 16 個來源 blob 未變，且官方 11 個 release gate 全 blocked。**本整合的最終 SHA 仍須有本身 GitHub Actions 真成功，不能沿用上表各 Owner 成功。**

## 2. 下一個必須真正突破的 Gate 與決策順序

**第一關：非生產環境／權限／個資與費用決策（AI-0/業主，不是程式碼有就能做）**。在任何真 Worker/DB/Store 實體操作前，必須有一份獨立批准證據：精確 Cloudflare 帳號/隔離測試 Worker 命名/Repo Branch、Sandbox 與正式 Resource 完全隔離、誰有最小權限和撤銷權、是否會付費/每月成本上限、Q104/Q119 合法保留與刪除、測試資料只用合成帳號、日誌遮罩、回滾/資料清除、明確批准的可做/不可做事項。**目前沒有這份授權，不以本檔自動創建。**

**第二關：#87 跨 D1 A/B 與 P05 權威**。要明確選定中央 Auth 身分、Billing 唯一 Store 交易、Battery 一次性免費 first claim 的 D1/Queue 事件路徑，以及唯一 P05 簽署者、不可回退的獨立 witness 和復原後拒絕重授權規則。純 SQLite :memory: 或 R24 chaos checklist 都不算真 Cloudflare 物理驗收；不得因此變更或取消目前 11/11 BLOCKED。

**第三關：精確資源隔離的受控驗證順序（全數需新批准）**：
1. **AI-4** 提供不接正式 `id-starry`、未被既有失敗 Trigger 監視的獨立 Preview/Worker 設計；保留現有 Cloudflare 觸發器**原狀**。確認 Access 是否公開、Wrangler 正式支援的 `previews` 設定、無正式 D1/Queue/KV/Secrets/Service 綁定、真正可回復/成本；只有審准後才操作。
2. **AI-1** 在已批准的隔離 Auth D1/Worker/Keyring 上用**合成會員**對官方 Apple/Google OIDC issuer/JWKS/PKCE／Session revoke 做真端到端驗證；不得把本地 HMAC signed fixture 當 provider Live。
3. **AI-2** 在核准的 Google Play/Sandbox 身分＋RTDN Pub/Sub 服務帳號和官方 JWKS/Play Developer API 上執行真交易、撤銷/退款/恢復、D1 durable anti-replay；**永遠不得讓單純 RTDN JWT 決定付費權益、去廣告或免費 Battery 購買**。
4. **AI-3** 在 #87/P05/授權都已決議、實體隔離資源存在後，依 16 項劇本以合成資料檢驗 multi-worker 跨 D1 concurrency、Queue ACK-after-commit、失敗重試/DLQ、PITR/外部 witness；不能因計畫存在而聲稱已演練。
5. **AI-0** 分別審核真正的外部證據、依 Gate 處理。EAS/iOS/Android/Store Sandbox、D-01～D-08、D-02 private Repo、產品 Market/法遵/Apple/Google 反重複仍是各自獨立決策，**不與中央會員正式發布 Gate 混用**。

**Cloudflare 事故保持真實區分**：#164 `id-starry` Build `239a1aaa-39ff-4e8e-b355-ccfa94edaecc` 確有 `npx wrangler preview` 缺 `previews` 設定的失敗紀錄，[RCA #165](https://github.com/starry-phd/id/pull/165)；R23/本 R24 GitHub CI 完成只是 offline，不表示 Cloudflare Preview 成功。AI-0 安全路徑 A：**保持現有 Trigger、不 Push 被監控 #164 branch**，獨立選項 B 必須取得明確核准。

## 3. AI-0 最終真值與下一輪 GitHub 交接

- 現行 R24 HEAD = 新增整合候選；**不合併任何 Draft PR 至 main**、不把候選升格 Production，不操作 Cloudflare Worker/Secrets/D1/Queue、Store/EAS、付費或 H-Global。
- 正式 [Release readiness](../release-readiness/release-readiness.v0.json)：**G00–G10 11/11 `blocked`，`release_authorization.granted=false`、`deployment_automation.can_auto_deploy=false`、P05/PUBLISHABLE=false**。
- Starry Battery **永久免費**；只允許 AI-3 本身唯一 Owner 發表合規授權。既有具名 App 由原開發者負責，AI-0 只維護跨 App SBASE 和產品策略。
- AI-1～AI-4 下輪不用重做離線 preflight；取得業主授權後才真正執行隔離環境實證。若業主尚未批准，**可先把風險/成本/Access/回退方案與來源文件完備，但不能聲稱 Live Gate 通過**。
