# AI-0｜R25 真實 Cloudflare 資源盤點＋中央會員受控驗證授權決策（2026-10-28）

> 狀態：**LIVE ACCOUNT METADATA READ / STAGING NOT AUTHORIZED / CENTRAL RELEASE BLOCKED**。本次是新的 Cloudflare **GET 唯讀盤點**，不是建立新 Worker、D1、Queue、購買服務、修復 Preview、產生會員 Session 或真驗收。本文件由 [R24 五組同版 Draft #177](https://github.com/starry-phd/id/pull/177) SHA `d01690371d8c38c2b50c12f5e90f395745bef1a0` 續接，避免重複匯入四 Owner 已整合的來源。真實證據以 [R25 inventory JSON](./r25-20261028-starry-cloudflare-readonly-inventory.v1.json) 為準。

## 1. 這次讀到的真實資源（僅已連接的 Starry Cloudflare 帳戶）

| 唯讀項目 | GitHub 之外真實查到的結果 | 不能推導的結論 |
|---|---|---|
| GET D1 database list | **1** 個 D1 資料庫 | 不能把它假設為專用 Auth/Billing/Battery staging；沒有讀取資料內容/資料表，也沒核實對應用途 |
| GET Queues list | **0** 個 Queue（本帳戶所見清單） | 不能因此宣稱跨所有 Cloudflare 帳戶不存在 Queue；但現階段不可用未經證實的 Queue/DLQ 宣稱 G07 live 成功 |
| GET Workers Scripts list | **6** 個 Worker script，包含已知 `id-starry` | 不能把現存腳本數量視為六個已核准中央驗收環境 |
| GET `id-starry` script settings | 回報 **0 個 bindings** | 不能宣稱已有實體中央 Auth D1/Queue binding；不能推論所有其他環境/版本也絕無 binding |
| GET 兩個歷史 `id-starry-…-preview` script settings | 各回報 **0 個 bindings** | 名稱含 preview 不是安全或有效 Preview 的證據，不能直接當合格隔離環境 |
| GET `id-starry` deployments | 最後一筆回傳 `2026-10-25T15:54:34.162822Z` | 不是 #177 新 SHA 正式部署的證據；也不取代全面環境／路由核對 |

**查核原則**：只在當前已連接的 Starry Cloudflare 帳號用 GET 查取**資源目錄與非秘密的設定摘要**；未使用 SQL、未操作 Live D1、未讀取用戶資料/Secrets、未建立/刪除/更新任何 Worker、Queue、D1、Route/Build/Trigger 或付費項目。基礎設施帳號 ID、D1 UUID、私密設定及身分資料不加入 Public GitHub。

**Cloudflare Build 注意**：Workers Builds 的 `external_script_id/script_tag` 不一定等於 Worker 名字，本輪以名稱查 Builds 得到的空清單／設定 GET 404 **不能拿來當作 Build 從未發生**。之前獨立 [AI-0 #165 的 Cloudflare 真日誌](https://github.com/starry-phd/id/pull/165) 已證明 #164 Worker Preview 失敗（`npx wrangler preview` 缺 `previews` 區塊）；此次沒有新實證可宣稱已修復，故仍按失敗事故處理。

## 2. 與 Starry v1.0 技術交接包的正確關係

上游：[共用基座 Issue #156](https://github.com/starry-phd/id/issues/156)、[AI-0 中央 Gate #1](https://github.com/starry-phd/id/issues/1)、[跨 D1 consistency ADR #87](https://github.com/starry-phd/id/issues/87) 與業主《Starry 生態系｜30–50 款營利 App 共用技術基座與 AI 開發前交接包 v1.0 候選版》（2026-10-28）。

- **AI-1** [#172](https://github.com/starry-phd/id/pull/172) G02/G03 是官方 Gate、Wrangler、簽章 Auth/SQLite 只讀程式預檢；Cloudflare 本帳號雖有 1 D1，**尚無獲批准且物理驗收的 Auth D1 binding、正式 OIDC/JWKS/Session**。
- **AI-2** [#174](https://github.com/starry-phd/id/pull/174) 的 RSA 簽章驗證針對**合成測試公鑰**；Google Pub/Sub bearer 簽章不是官方 Play Developer API 的購買/退款事實。**D-03 唯一 Store 權益權威未裁決**，不可 Grant、去廣告或扣款。
- **AI-3** [#173](https://github.com/starry-phd/id/pull/173) 的 16 項物理 D1/Queue/PITR 驗收是**離線劇本**；此 Cloudflare 帳戶顯示 **0 Queue**，所以不可能以現有已查資源聲稱已完成真 Queue ACK-after-commit/DLQ 測試。
- **AI-4** [#175](https://github.com/starry-phd/id/pull/175) 是 `*.invalid` 合成 Session+SQLite/HTTP 邊界；Cloudflare `id-starry` 並未因 Node 204/401 測試而新增正式 Auth API／Preview。
- **AI-0** [#176](https://github.com/starry-phd/id/pull/176) 是 App 開案反同質化/證據 Gate。Expo 58/RN 0.88、pnpm/Turbo、Hono/Zod/OpenAPI/Native 三款 P0、RevenueCat/AdMob/Store Sandbox 仍按技術包列候選，不因本次 Cloudflare GET 盤點而核准。

## 3. R25 最小安全前進方案（尚未取得業主批准）

**建議採「先零資源修改的批准決策，再最小隔離的合成 Staging」**，不直接在 `id-starry` 上補資源或覆寫 Trigger，也不把現有未知用途 D1 當測試池。

| 階段 | 需要誰確認、明確決議的內容 | 本輪驗收真值 |
|---|---|---|
| **A｜選擇是否建立獨立 Staging** | 業主選擇「先維持全部唯讀」或「授權另設隔離 Starry synthetic-only Worker＋最小 D1/Queue」，並指定能否有費用／每月上限；不得碰正式 `id-starry` | **OWNER_DECISION_REQUIRED** |
| **B｜#87 一致性模式** | 業主與 AI-0/Owner 技術審查：A 單一中央資料權威（單庫交易可行範圍）vs B 多 D1 outbox/saga（含 Durable ACK、獨立不可回退 witness）。不得用本輪 CLI 自動裁定 | **UNDECIDED** |
| **C｜合法個資／P05 簽署者** | Q104/Q119 的保留刪除／稽核與備份責任、P05 唯一 signer、合成資料保護、Key custody、輸出遮罩與可撤銷 Access；實作需 Owner 正式規格優先 | **NO_APPROVAL** |
| **D｜最小操作／停損設計** | AI-4 提供新 Worker/Branch/實際端點/路由隔離、無任何 Production binding、Deploy rollback、權限清單、預估成本及閾值；其他 Owner 各提出外部測試資料與結果證據，不混 Store／Auth／Queue scope | **PROPOSAL_ONLY** |
| **E｜正式執行** | 只有 D-02／D-03 等影響的選型及實際 Cloudflare／Store/付款/部署授權逐項明確核准後才能進行；留存真實 resource ID（保存在私密控制台，不貼 Public Repo）、CI/Build/Log redaction 與復原紀錄 | **NOT_STARTED** |

**最低實驗先後順序（若且唯若另行獲核准）**：AI-4 建立**完全隔離的合成 Staging 入口** → AI-1 在專屬測試身分+D1+已審查金鑰中測 Session revoke → AI-3 依 #87/P05 核准方案在隔離 Queue/D1 跑 ACK/重放/PITR → AI-2 用**另行授權**的 Google Play Sandbox/OIDC JWKS 做真 Store 交易/撤銷/退款；各階段隨時可停止、撤銷與清理。不接受先 Deploy 正式 Worker 再事後補 Gate。

**此刻 AI-0 建議**：**不要再讓四位只寫更多離線 mock 來冒充推進**；下一輪應交由業主對隔離資源、成本、#87、P05/Q104/Q119 做正式選擇。若仍不核准雲端操作，將所有測試明確保持候選/阻塞，不排程不存在的真測試。

## 4. Release 與 GitHub 證據分層

最新四 Owner+AI-0 R24 [Draft #177](https://github.com/starry-phd/id/pull/177) HEAD `d01690371d8c38c2b50c12f5e90f395745bef1a0`，同 SHA [AI-0 完整離線 CI #40642082070](https://github.com/starry-phd/id/actions/runs/40642082070) 10/10 通過、AI-1/AI-2 完整工作流亦通過；**全是離線真程式測試，不是 Staging／Production。**

[官方 release-readiness](../release-readiness/release-readiness.v0.json) **G00～G10 11/11 BLOCKED**、P05/PUBLISHABLE=false、`release_authorization.granted=false`、`deployment_automation.can_auto_deploy=false`。本新 R25 Draft 僅新增 AI-0 唯讀證據及治理測試：**不更動**任何 Owner 原碼、Cloudflare、main、GitHub Workflow、Secret、D1/Queue、Google Store/EAS、付費或 H-Global。
