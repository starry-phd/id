# AI-0 總管｜換新對話 GitHub-only 正式交接包（Wave1 R008）

> 交接快照：2026-10-29（台灣）。**唯一日常協調入口：GitHub Issue #1；換對話入口：Issue #220；工程原件：本檔所在獨立 Draft PR。**
>
> 此文件是當時已核對的 **版本化歷史快照**，不是即時監控器。新對話必須先讀取 #1、#220、最新 PR／實際 HEAD／CI 再行動；若後續 GitHub 有更新，以實際來源為準。
>
> GitHub Repo（Public）：https://github.com/starry-phd/id。不要把任何真會員個資、憑證、token、Secrets 或機密交接包提交到 Public Repo。

## 0. 最短接手程序（新 AI-0 首先執行）

1. 以 ChatGPT 人工喚醒開啟 **新 AI-0 對話**，讀 [Issue #220](https://github.com/starry-phd/id/issues/220) 本輪交接入口、[AI-0 總管 #1](https://github.com/starry-phd/id/issues/1) 最新留言，以及 [AGENTS.md](https://github.com/starry-phd/id/blob/main/AGENTS.md)、[GitHub-only HANDOFF-PROTOCOL](https://github.com/starry-phd/id/blob/main/docs/ai/HANDOFF-PROTOCOL.md)。**注意：main 上的規範可讀，但未合併 Draft 裡的 R008 程式需讀其對應 PR branch／commit，不能從 main 猜測。**
2. 真正查核 [AI-0 四 Owner R008 整合 #234](https://github.com/starry-phd/id/pull/234) final `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9` 與 exact-SHA CI；追查 [上線前唯讀盤點 #235](https://github.com/starry-phd/id/pull/235) final `f12ffd8d7b7590d64724213b3d891b8275110c63`；查 [P05 規格對照 #236](https://github.com/starry-phd/id/pull/236) final `7b409fb788ebdbca1d9569beae7ec04822063710`。**#236 是當時最新 AI-0 文件/工程繼承鏈頂點；#234 才是四 Owner 真正新同 SHA 離線整合證據。**
3. 核對四 Owner 最新 Draft PR／final SHA（見下一節），不能直接假定交接快照中的 SHA 永遠最新。核實有無新的外部 Check、樹差異、merge、其他參與者的更動。
4. 讀 [正式發布 Gate JSON](https://github.com/starry-phd/id/blob/main/docs/release-readiness/release-readiness.v0.json) **以及 #236 隔離 branch 裡的同一檔**，不得將規劃、local synthetic PASS、實際雲端部署或業主批准混淆。
5. 以 **GitHub Issues／獨立 Draft PR／原始 Commit SHA／同 SHA Actions** 紀錄全部任務和交接；**不可要求業主在五個對話間複製整份技術交接**。如果需另一個 AI 繼續，先在它的專屬 Issue 發正式工作令；該 ChatGPT 對話仍須業主人工喚醒，Issue 留言本身不會自動啟動 AI。

## 1. 四位 Owner 的 R008 最終交付（原始 blob 不可重寫）

| Owner | 專責 Issue | R008 Draft PR | 已驗證最終 commit | 交付 |
|---|---|---|---|---|
| AI-1 Starry Auth／Session | [#2](https://github.com/starry-phd/id/issues/2) | [#231](https://github.com/starry-phd/id/pull/231) | `d668add2153bae35ec89c55786d368718bdf61f6` | 3 個原始 blobs；本機 Auth CAS、撤權／重播拒絕 |
| AI-2 Billing／Store／RevenueCat | [#3](https://github.com/starry-phd/id/issues/3) | [#228](https://github.com/starry-phd/id/pull/228) | `70b12ae7722ca7f9f4b3e975a5e43416a3ea2c5b` | 3 個原始 blobs；不可信雙來源衝突拒絕 |
| AI-3 P05／P06 隱私／復原 | [#4](https://github.com/starry-phd/id/issues/4) | [#232](https://github.com/starry-phd/id/pull/232) | `46ea40cba9074c2d8bca76a0916428b974d643f5` | 3 個原始 blobs；SQLite memory outbox／撤權／刪除／PITR 負測 |
| AI-4 Expo／Workers／Preview | [#5](https://github.com/starry-phd/id/issues/5) | [#229](https://github.com/starry-phd/id/pull/229) | `faa29e2efb179f413a167933b22b92cbe0df9334` | 3 個原始 blobs；Cloudflare Preview 隔離 preflight 拒絕 |

四 Owner **12/12 original Git blobs byte-for-byte** 已收錄 [AI-0 #234](https://github.com/starry-phd/id/pull/234)；來源精確清單 `docs/operations/ai0-wave1-r008-four-owner-source.v1.json` 位於 #234 的 branch。四 Owner R008 專責 PR 都是 **OPEN/DRAFT**，沒有合併 main。不要重做 R008，也不應把各 Owner 不同 SHA 的 CI 合成「同 SHA」驗收。

## 2. AI-0 已完成的真正交付與證據

| 節點 | GitHub 實體／SHA | 真正證明 | 邊界 |
|---|---|---|---|
| Cloudflare Preview 關閉治理 | [#227](https://github.com/starry-phd/id/pull/227) `aecdee944158b40ffbbd129ddd126136687d7652` | 經業主同意，**只有** Starry Cloudflare `id-starry` Preview 自動建置關閉；production auto-build 原本就 OFF；Cloudflare API 先 PATCH 並重查成功；之後僅 GET 確認 | 不表示 Worker Preview 問題已修復、不表示做過 Deploy |
| 兩 Owner 部分預整合 | [#230](https://github.com/starry-phd/id/pull/230) `4d14f517ac08e6914159143d60a9cb60a9389ef7` | AI-2/AI-4 原始 6 blobs；[同 SHA AI-0 CI](https://github.com/starry-phd/id/actions/runs/40743995391) 成功 | 只是 2/4，不是 R008 四 Owner Gate |
| 四 Domain 過渡安全負測 | [#233](https://github.com/starry-phd/id/pull/233) `e815561a2d6549da792df59190f7bb727bd5c9ce` | AI-0 專用 legacy bridge denial；CI 成功 | AI-1/AI-3 在該檔當時仍 R007 inherited |
| **R008 真四 Owner 同版整合** | **[#234](https://github.com/starry-phd/id/pull/234)** `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9` | [AI-0 Actions #40745802066](https://github.com/starry-phd/id/actions/runs/40745802066) ＋ [Auth #40745803356](https://github.com/starry-phd/id/actions/runs/40745803356)，**同一 SHA 全部 SUCCESS**。完整離線 CI **1,776/1,776 Node、413/413 SQLite :memory:、零失敗**；strict TypeScript/lint、Expo54 DEV config、Worker dry-run、release blocked 通過 | 僅 **Gate2 R008 OFFLINE PASS**，非真平台驗證 |
| 真 Starry Cloudflare 資源／11 Gate 稽核 | [#235](https://github.com/starry-phd/id/pull/235) `f12ffd8d7b7590d64724213b3d891b8275110c63` | [同 SHA CI #40746819887](https://github.com/starry-phd/id/actions/runs/40746819887) SUCCESS；兩份 AI-0 唯讀稽核 docs | Cloudflare 單帳號時間點列表；不是 live 或持續觀測 |
| P05 來源差異對照 | **[#236](https://github.com/starry-phd/id/pull/236)** `7b409fb788ebdbca1d9569beae7ec04822063710` | [同 SHA CI #40747590465](https://github.com/starry-phd/id/actions/runs/40747590465) SUCCESS；新增兩份逐欄對照 doc/JSON | 沒核定第 13 欄、沒有改實作或 P05 正式契約 |

以上均為獨立 **OPEN/DRAFT PR**，未進入 main。#236 是 #235 → #234 的直接 commit 後代；新 AI-0 若須追加 *只讀文件／候選計畫* 可從當次最新驗證 HEAD 建 **自己獨立 branch／Draft**，但不得未獲核准合併。

## 3. 真平台唯讀結果（避免誤判已可上線）

[PR #235](https://github.com/starry-phd/id/pull/235) 依 Starry Cloudflare 已認證 GET 的歷史回應：Workers **6**，D1 **1**（名稱 `echo-starry`，**不能假定這是真 Auth 或 Billing D1**），Queues **0**；`id-starry` `previews_enabled=false`、`auto_build_enabled=false`，Git 連到 `starry-phd/id`，production branch `main`。這只是單一 Starry 帳戶的當時列表，不是 Secrets、付費帳單、跨品牌隔離、D1 真實資料、路由、部署狀態的全面核驗。Cloudflare R007 歷史 external check `npx wrangler preview` 失敗是單獨歷史事實，不能因後來關閉自動 Preview 就稱其為 PASS。

## 4. 絕對不能擅自放行的正式 Gate

- **Gate1：PARTIAL／BLOCKED。**
- **Gate2：R008 四 Owner 整合 exact SHA `e47c068...` OFFLINE PASS ONLY。** 任何 doc-only 後代 CI PASS 不能自動升級為 Live。
- **Gate3：G00–G10 共 11/11 BLOCKED，正式 release readiness 每個 Gate `evidence=[]`，`release_authorization.granted=false`，P05/PUBLISHABLE=false，auto deploy=false。**
- Starry Battery 永久免費、Ads OFF、Expo54 不變；H-Global 目前停止開發。**未經新業主逐項明確授權：不合併 main、不部署 Preview/Staging/Production、不重新開啟 Cloudflare Builds、不寫真 D1/Queues/Store/RevenueCat/EAS、Secrets、付費資源，不改 H-Global。**
- Starry 與 H-Global 的 Auth、User ID、Session、D1、金流、Secrets、雲端與部署獨立；未來基本資料跨品牌 API 僅保留**預設停用的設計接口**，不許替 H-Global 做實作。Public Repo 不存機密。
- AI-1/2/3/4 GitHub 專責 Issue 只是交接，**不會自動喚醒各自 ChatGPT 對話**。業主人工啟動是必要條件。無 Copilot Pro、OpenAI API、Codex 背景自動代理作為必需品。

## 5. 下一階段真正待決（業主／安全／法遵與真實平台證據）

依 [#235 稽核表](https://github.com/starry-phd/id/pull/235)、[#236 P05 對照](https://github.com/starry-phd/id/pull/236)：

1. **G00／MVP／128 項需求**：正式指定第一款 Starry App、第一版功能範圍、原清單 108＋管理預留 P10＋新架構 N10 各項保留／取代／延後；目前 G00 無完成證據。
2. **G06／P05 事件 schema 差異**：ADMIN-PREP [#13](https://github.com/starry-phd/id/issues/13) 及 `docs/contracts/FUTURE-STARRY-ADMIN-API.md §2.3` 是 **11 個核心欄位＋付款／重試才帶的 1 個 idempotency_key**；正式 `release-readiness.v0.json` G06 說 **13 欄但未列出第 13 欄名稱**；離線 `AI0_R006_FIELDS` 有 **17 欄**，與 11+1 管理列表僅 6 欄同名，`AI0_R006_LIVE=false`。**不能猜第 13 欄或靜默等同不同欄位**。是否採分層事件核心＋簽章安全 envelope 或單一正式版本，都待業主決策。
3. **#87／跨 D1**：A 單一 Starry 交易權威 vs B Durable Outbox/Saga 尚無業主核准；SQLite memory success 不能冒充分散式原子交易。
4. **Q104／Q119**：個資保存、刪除、撤權、申訴／法律保全與復原條件需正式法遵決策，不能從 synthetic fixture 推定年限。
5. **G01～G10 的真測試環境／帳號／費用**：獨立 Starry staging Auth D1/Queues/DLQ、KMS／Issuer／Anti-PITR、官方 Apple/Google OIDC/Store Sandbox、RevenueCat、保護 Worker、設備 E2E／EAS、Cloudflare URL/Access/Bindings／配額／預算及回退；每一項執行前需業主**另行授權範圍、資源與預算**。
6. **ADMIN-PREP P01～P10**：第一波只預留必要接入接口，並在 [Issue #13](https://github.com/starry-phd/id/issues/13) 核對；不建第二波 60 個空端點／共用超級 DB gateway／H-Global 管理端。首款 App/MVP 與此項別混淆。

## 6. 新對話可立即執行／不可執行

可直接執行：GitHub 原件／CI／Issue 唯讀核查、需求 SSOT source mapping、P05 層次候選比較、#87 A/B 風險與測試成本比較、Q104/119 待法務決策表、G00–G10 evidence-gap 對照、AI-0 **只讀／離線的獨立 Draft**，並將結果記錄到 #1／相關 Issue。

必須等待另外授權：正式架構決議、秘密金鑰、真資源新增修改、費用、Cloudflare Preview/Worker 實際執行、原生打包發佈、真商店支付／會員資料操作、Production、main merge、Ads 與 H-Global。不能把「繼續」、「換新對話」誤當成上述授權。

## 7. 接手後固定交接格式

每個變更在 AI-0 Issue #1／相關專責 Issue 寫入：
- 工作狀態：PLANNING / DRAFT / EXACT-SHA OFFLINE VERIFIED / LIVE VERIFIED / BLOCKED / MERGED / DEPLOYED（必須有相應來源）。
- 來源：Issue／PR URL；所用 parent SHA、新 HEAD SHA、Owner 原始 blobs／有無變更。
- CI：GitHub Actions run URL、該 workflow 的 `head_sha`、PASS/FAIL；Cloudflare external check 另列，不能混稱。
- 閘門：Gate1/2/3、P05、Ads、費用、部署狀態；卡點、核准來源、後續最小安全動作。
- 若尚未收件／等待某組，確實註記待交付；**絕不憑聊天宣稱 GitHub 已完成**。

## 8. 舊交接如何處理

[Issue #220](https://github.com/starry-phd/id/issues/220) 曾以 **R006 尚未四組同 SHA 整合**為題，**內容已被 R007／R008 實際 GitHub 交付取代**。保留 GitHub 編輯／事件歷史作審計，不再依其舊 R006 快照派工。本輪會把 #220 入口更新為本 R008 新 GitHub 交接，日後仍以 #1 最新 Gate 真相與實際 PR/CI 優先。

**新 AI-0 建議啟動句**：「接手 `starry-phd/id` 的 AI-0 總管。先讀 Issue #220 最新交接及 Issue #1、AGENTS.md、HANDOFF-PROTOCOL，核對最新 PR #234～#236、四組 Owner PR/CI 和 Gate，依 GitHub 已核准範圍繼續；不重做 R008，不動 main 或正式雲端。」
