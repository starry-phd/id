# Starry ID｜AI-0～AI-4 五組 AI 協作規範
> Repository: `starry-phd/id` (Public)
> GitHub Owner: `starry-phd`; personal administrator: `yukidu`.
> 狀態：全新開發；此檔是工程分工規則，不代表五個 AI 已自行啟動，也不是任何功能完成、CI 通過或 Production 上線的證明。

## 2026-10-26 最新落地狀態｜**非 Codex / GitHub Copilot 預備，AI 尚未自動執行**
- 已合併 [PR #9](https://github.com/starry-phd/id/pull/9)：五個 GitHub Copilot 自訂角色 `.github/agents/`、GitHub CI、預設停用的 Staging／受保護 Production 工作流程。
- [main GitHub CI](https://github.com/starry-phd/id/actions/runs/40244400726) 僅 `Repository policy` 真正 PASS；App typecheck/lint/tests SKIPPED，尚無 app scaffold。
- 使用者正式否決現階段 Codex／OpenAI Platform API Key 背景自動執行；原 PR #7 PAUSED／不得合併；不得調用 `/codex-run-all`。
- GitHub Copilot Cloud Agent 需要獨立付費席位、Org 管理者允許及任務觸發；**目前未經確認任何 AI-1～4 背景運行。** Public Repo 無法使用原生 Copilot Automations 定時／事件觸發。
- Cloudflare `id-starry` 的 Workers Builds 自動建置目前停用；沒有核准正式部署。所有實際進度以 GitHub CI／PR／Issue 證據為準。
- 組織 Admin／Copilot 授權／Secret／安全與 Environment 待驗證，詳 [GitHub Team × Copilot readiness](docs/operations/GITHUB-TEAM-COPILOT-READINESS.md) 和 [Issue #8](https://github.com/starry-phd/id/issues/8)。

## 最新業主指令｜GitHub-only 五 AI 協作、H-Global 暫停（優先於下列一般規範）
1. **AI-0、AI-1、AI-2、AI-3、AI-4 的所有工作交接僅透過此 Repo 的 GitHub Issues、PR、Commit、CI 和版本化文件；業主不負責在 AI 對話之間人工轉貼。** 詳見 [GitHub 交接協定](docs/ai/HANDOFF-PROTOCOL.md)。
2. **Starry 是目前唯一開發標的。H-Global1985 的功能、Repo、Cloudflare Workers/D1、資料庫、登入、付款、部署一律暫停**，除非業主日後明確解除。任何 AI 不得替 H-Global 進行代工或順便開發。
3. **保留未來會員基本資料跨品牌 API 接口**，僅在 Starry 端預留契約／禁用的抽象層與 Mock；不得建立 H-Global 實作或串接真正服務。詳見 [未來雙品牌會員 API 預留契約（DISABLED）](docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md)。
4. 兩品牌獨立 Auth／User ID／Session／D1／Secrets；未來僅在雙方各自驗證、本人同意與指定欄位獲核准後，透過版本化 API 交換基本資料。**預設停用、失敗即拒絕，不依 Email／姓名合併，不共享資料庫。**
5. 跨 AI 提問與交接必須在來源 Issue／PR 留有證據，將依賴與交接連結貼到接手 AI 的 Issue；不得以 ChatGPT 口頭消息取代 GitHub 留痕。
6. **GitHub 留下任務不會自動執行另外四個 AI**；只有在對應已授權的 GitHub Copilot Cloud Agent 或其他 Agent 執行環境已連線、讀取 Issue 且收到實際執行觸發時才會啟動。不得聲稱五組已同時實作而沒有 PR／CI 證據。
7. 僅需業主批准涉及產品決策、付費、Production 或高風險操作時請示；業主**不需人工轉達工程交接**。

## 0. 共同依據與適用範圍
- 本 Repo 僅用於 **Starry ID** 全新架構。沿用已核准的產品需求、人工審閱後的第一波交接包；不沿用舊 GitHub Repo 原始碼、舊資料庫、舊 secrets、歷史 PR 或部署狀態。
- 以「第一波《開發清單交接包》」及 DEV-A～DEV-I 經核准部分為需求依據；**標示待人工審閱、互相衝突或尚未定案者不可直接當作實作需求**。
- 預設技術選型：React Native + Expo + Expo Router + TypeScript；Cloudflare Workers + TypeScript；依需求使用 D1／R2／Queues；OpenAPI 3.x；GitHub Branch → Draft PR → CI → AI-0 驗收 → 人工確認後受控合併與部署。
- Starry 與 H-Global 必須維持獨立 Auth、user ID、會員資料庫、Session、Secrets、付款、授權、雲端資源和部署。必要的跨系連結經雙邊驗證、會員同意與明定 HTTPS 契約；**本 Repo 不負責 H-Global 正式開發或部署**。
- Starry Battery 免費且只適用 Starry 生態系；不得逕行設計成付費點數、購買權益或沿用舊 FEFO 等未核准規則。
- Public Repo：絕不提交私人資料、token、secret、正式憑證、金流密鑰、.env、正式用戶資料或機密內部文件。

## 1. 固定角色
| 編號 | 主要負責領域 | 首要交付 |
| --- | --- | --- |
| **AI-0｜總指揮與整合** | 技術決策、需求判定、Issue 分派、契約協調、跨模組整合、測試 Gate、版本與部署把關 | 首版架構與模組邊界、接口決策、驗收清單、合併建議 |
| **AI-1｜身份與會員** | Starry 獨立 Auth、OIDC/PKCE/JWKS、登入安全、Session、會員資料、資料可見度、權限/隱私；跨品牌僅規劃已核准契約 | 可測試的 Auth／會員 API、D1 schema migration 草案、對應測試 |
| **AI-2｜數位訂閱與內購** | Starry Billing、App Store / Google Play IAP、收據/通知驗證、權益、訂單與冪等；僅 Sandbox | 可測試訂閱流程與驗證契約、沙盒測試；不碰真實扣款 |
| **AI-3｜電池艙與信任安全** | 免費 Starry Battery、通知、申訴、稽核、隱私操作、撤權與復原、佇列重試 | 可測試的安全事件／稽核／通知規格與模組 |
| **AI-4｜技術基座與 DevOps** | React Native／Expo／Expo Router 基座、Cloudflare Workers、OpenAPI/SDK、CI、預覽部署、上架工具鏈 | 可重現開發環境、最小可執行基座、CI 與契約測試 |

## 2. 平行開發界線
1. **先契約、後平行實作**：AI-0/AI-4 協調 OpenAPI／DTO／資料擁有權；AI-1～3 只能根據已核准契約開發。
2. 每個 AI 使用自己的 Issue 與分支（建議 `ai1/`、`ai2/`、`ai3/`、`ai4/`、`ai0/` 前綴），修改範圍互不重疊；不得多人同時改動同一 DB migration／CI／shared 契約檔。
3. 每組交付 **Draft PR**，包含關聯 Issue、檔案清單、測試指令/結果、SHA、風險、待決問題；不得因「寫完程式」就宣稱完成驗收。
4. **未經 AI-0 Gate 驗收及業主授權，不得合併 main、部署 Production、操作正式 DB／金流、發布 App 或更改正式憑證。** 初始化空白 Repo 的本分工文件除外。
5. GitHub Issues / PR / CI 是協作紀錄和交接真實來源；ChatGPT 對話不會因 Issue 自動喚醒其他 AI。**AI-1～AI-4 須由各自可用且已核准的 GitHub Copilot Cloud Agent 或其他 Agent 執行環境實際啟動、讀取其 Issue，才會開始工作。**
6. 公開 Repo 的外部 PR 不可在有正式部署密鑰的 CI 中執行；限制 Workflow 權限、採最小權限 Token、必要時使用環境保護與人工批准。
7. 遵守既有《GitHub AI 自動化開發合規與防封鎖 SOP》：寫入請求保守速率、序列化 mutating API、冪等、避免重複 Issue／CI／高頻輪詢，遇限流或異常暫停並查核；限額不是規避平台政策的保證。

## 3. AI-0 Gate 與可驗證狀態
- Gate 0：組織與 Connector 權限、需求版本、Repo 初始化與祕密管理規則核對。
- Gate 1：模組邊界、Auth、Billing、Battery、通知與 OpenAPI 契約經整合審閱。
- Gate 2：每組 Draft PR 的 CI / 靜態檢查 / 單元測試與跨模組隔離測試。
- Gate 3：安全／隱私／IAP 沙盒與回滾驗收，由業主明確確認後才允許 main／Production。
- 狀態須標示：規劃中、開發中、Draft PR、CI 通過、待驗收、已合併、已正式部署；不可混為一談。

## 4. 各 Agent 開始前必讀
- 本檔 `AGENTS.md`
- AI-0 協調 Issue 與自身專責 Issue
- 經核准的「第一波《開發清單交接包》」與對應 DEV 文件
- 其他 AI 已核准的契約／整合決議，不得自行覆寫

> 變更規則：若需求交接包與 Repo 契約衝突，先在 Issue 註明差異交由 AI-0 決策；不自動沿用舊案實作。
