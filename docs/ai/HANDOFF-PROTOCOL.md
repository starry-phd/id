# Starry ID｜AI-0～AI-4 GitHub 唯一交接與協調協定
> Owner: `starry-phd` · Repo: `starry-phd/id` · Status: decision recorded, agent execution not auto-triggered.
> 本文件為 2026-10-26 業主最新決議；與舊交接方式衝突時，以本文件的「GitHub 交接」與「H-Global 暫停」限制優先。

## 現行優先規範｜2026-10-29 整合版 v1.0 / 流程 v3.0

依業主本次授權，後續未完成工作採[最新開發技術規範](https://docs.google.com/document/d/1urLja9i9A63jHuz4jQPhPMTgoCtoq-i1TafXPQd3PYU)。本節及[工程落實規則](OPTIMIZED-DEVELOPMENT.md)取代下文衝突的歷史啟動、分工和重複核准敘述；其餘已核准需求保留。GitHub #220 是最新工程進度入口。

- 一個垂直切片、一位主責實作者、一個主 PR；最多兩個相互獨立切片。其他 Owner 按領域審查，不強制四份平行實作與永久三層來源提升。
- AI-0 已獲必要合併／部署操作授權，仍須具體範圍、驗收及各環境准入；授權不等於驗收通過，不反覆詢問已批准事項。
- Issue 留言不會啟動其他對話；分別記錄已派工、實際啟動、已交付與已驗收。不購買付費背景 Agent。
- 合併、staging、production、商店發布分別驗收；main/tag 不自動部署。保留正式發布封鎖，guard 透過受審 PR 演進。
- 僅中央會員系統；H-Global／繁星回聲不介入，Battery 免費、Ads OFF。未核准費用或新真資源不自行建立。

## 2026-10-26 最新執行模式（業主正式決議）
**ChatGPT × 5 組人工喚醒 + GitHub 共享交接，不購買 Copilot Pro、不使用 Codex／OpenAI Platform API 自動執行。** 五組 ChatGPT 對話彼此不能直接叫醒，也不會共享所有聊天即時狀態；每次由業主開啟對應對話後，專責 AI 先讀 GitHub Issue、版本化契約、前手 PR／CI，再執行並留下證據。此決議優先於本文的過往 Copilot 條款。
- AI-0 總管 → [Issue #1](https://github.com/starry-phd/id/issues/1)
- AI-1 Auth／會員 → [Issue #2](https://github.com/starry-phd/id/issues/2)
- AI-2 Billing／IAP → [Issue #3](https://github.com/starry-phd/id/issues/3)
- AI-3 免費 Battery／安全／稽核 → [Issue #4](https://github.com/starry-phd/id/issues/4)
- AI-4 Expo／Workers／OpenAPI → [Issue #5](https://github.com/starry-phd/id/issues/5)
- **人工叫醒句型**：「繼續 starry-phd/id Issue #X。先讀 AGENTS.md、HANDOFF-PROTOCOL、相關 Issue／PR／CI，依已核准範圍完成本輪可交付內容，將 SHA、Draft PR、測試與阻塞寫回 GitHub。」
- **接力**：當某組完成 GitHub HANDOFF，使用者可人工開啟下一組 ChatGPT 對話並只給 Issue 編號，不必貼完整交接包；若該聊天當次無 GitHub 存取權，仍須提供鏈接／授權後才能確實接力。
- GitHub Actions 一般 CI／Dependabot 仍可依觸發自行執行，這**不是 AI-1～4 在背景工作**。正式部署、跨品牌 H-Global、真實個資與扣款不授權。

## A. 最高優先決議
1. **五組 AI（AI-0、AI-1、AI-2、AI-3、AI-4）所有工程任務、疑問、決策、交接、測試證據、阻塞與驗收，均在此 GitHub Repo 進行。** 不要求業主在五組聊天之間複製／轉貼交接內容。
2. 目前**只有 Starry ID / Starry 生態系範圍准許開發**；**H-Global1985 所有實作、雲端資源、會員資料庫、登入、API 服務、部署、GitHub Repo 操作一律暫停**，除非有新的明確業主決議解除暫停。
3. **預留未來 Starry 與 H-Global 會員基本資料 API 串接介面**，僅限 Starry 端不啟用的契約、抽象層或 mock；不建立 H-Global 後端、不寫 H-Global D1、不互傳真實會員資料。
4. GitHub Repo Public；只放非機密文檔與程式。嚴禁 secrets、正式會員資料、正式環境憑證。

## B. GitHub 作為唯一工作交接通道
- **規範**：`AGENTS.md`、`docs/ai/HANDOFF-PROTOCOL.md`、`docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md`。
- **任務分配／規格問題／決策紀錄**：GitHub Issues（AI-0: #1；AI-1: #2；AI-2: #3；AI-3: #4；AI-4: #5；跨品牌預留介面：見專題 Issue）。
- **程式變更、審閱、CI、測試及 SHA**：以各自 Branch／Draft PR 作為可稽核紀錄；PR 必須關聯 Issue。
- **跨組交接**：在原 Issue/PR 寫明依賴的下游 Issue/PR，並在下游 Issue 寫一則交接摘要，提供固定 URL、commit SHA、介面版本、驗收證據及下一步；禁止只說「我已告訴使用者」。
- **決策衝突**：由 AI-0 在 #1 記錄裁決與決策依據，必要時更新正式契約文件；不能只靠聊天內容改變工程事實。
- **狀態及真相來源**：每個專責 Issue 必須更新狀態；`planning / blocked / ready / in progress / draft PR / CI verified / awaiting gate / merged / deployed` 必須跟 GitHub 證據一致，不得把規劃當完成。
- **不要通知業主幫忙代傳**；若遇權限、收費、Production 發布等需批准情況，AI-0 可請業主作決策，但實際工程交接仍透過 GitHub 紀錄。

### 交接留言必備欄位
```markdown
## HANDOFF: AI-X → AI-Y
- Issue: #...
- 目前狀態: planning | blocked | ready | in progress | draft PR | CI verified | awaiting gate
- 交接目的／範圍:
- 契約版本／變更:
- 分支與 Commit SHA:
- Draft PR:
- 驗證指令、CI run URL 與結果:
- 依賴／阻塞:
- 接手 AI 下一步操作:
- 是否需要 AI-0 Gate 決策:
- 確認無 H-Global 實作、無正式資料、無 Secrets:
```

## C. 預留跨品牌 API 的範圍
- 以 `docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md` 為**預留設計文檔**；未核准的「同步欄位清單」「真正 URL」「最終 OAuth/scopes」不得推定已決議。
- 獨立 Starry `s_user_id` 與獨立未來 H-Global `h_user_id`；不共用 Auth／Session／D1／金流／Secrets，不因相同 Email／姓名自動合併。
- 僅在未來 **雙系運行、兩邊身份驗證、本人授權與指定欄位清單核准** 後，才允許透過受保護的 HTTPS API／版本化契約交換指定基本欄位；需支援撤銷、稽核、錯誤/衝突處理與最小權限。
- **預設功能旗標關閉**（設計名稱 `CROSS_BRAND_MEMBER_SYNC_ENABLED=false`，此時只是規格慣例，非已部署環境變數）；沒有 H-Global 側可用服務時採 fail-closed，不模擬為已連通。
- 尚未實作的 API 不得在 README／進度報告宣稱「串接已完成」。

## D. 執行限制
- 此 Repo 裡建立 Issue、寫入規範**不會自動啟動五個 ChatGPT 對話**。目前採**業主人工喚醒**，各 ChatGPT 對話在當次互動中自行讀取 GitHub Issue 並回寫證據；未購買、不要求或自動啟用 Copilot Cloud Agent。
- AI-0 為由業主人工喚醒的 ChatGPT 總管；不得承諾聊天在無人觸發時自動工作。過去 Copilot Automations 方案未採納，不列開發前置條件。
- 遵守 GitHub AI API 安全 SOP：序列化寫入、去重、保守限流、只用需要的資源權限；無高頻 polling 或重複 CI。
- 無 AI-0 驗收及業主發布授權，不合併 main、不動 Production／正式 D1／真實付款；文檔規範初始化之例外限本次批准的規劃寫入。

## E. 第一輪 Gate
- [x] AI-0～4 GitHub Issues 建立
- [x] GitHub-only handoff 決議寫入 repo
- [ ] **人工喚醒各 ChatGPT AI 時**，分別驗證該次 GitHub 連接器可讀自己的 Issue／PR，並將完成證據回寫 GitHub；不需 Copilot 席位
- [ ] 認定已核准的 Starry ID 功能規格及跨品牌預留欄位待決清單
- [ ] AI-1／AI-4 設計並提交預留契約；AI-0 Gate 1 審閱
- [ ] 各組實際 Draft PR 與 CI 檢查

## F. 第二波超級／中央管理中心 ADMIN-PREP（已同意的第一波預留）
- 第一波 Starry 程式必須在 #13 留下 P01～P10 驗收證據；正式規格見 [FUTURE-STARRY-ADMIN-API.md](../contracts/FUTURE-STARRY-ADMIN-API.md)，以經核准主清單 ADMIN-PREP 為優先。
- GitHub AI-0/1/2/3/4 在自己的 Issue、Draft PR 交接時附上該模組的 App/Brand/Env/管理 scopes/事件/稽核/監控成本/發行證據、是否已真正實作與測試。AI-4 標準化 OpenAPI/SDK；AI-1 Starry 管理員驗證；AI-2 Billing；AI-3 Battery/稽核；AI-0 Gate。
- 這項預留不啟動第二波 60 個中心的完整 React 管理 UI、不建跨品牌超級權限、不摸 H-Global。它與 #6 的未來會員基本資料跨品牌同步是兩種不同接口。

