# Starry ID｜GitHub Team + Copilot 多角色協作就緒稽核與執行手冊（Copilot 未採用，歷史參考）
> **已撤回的選項（2026-10-26 業主最新決議）**：**不購買 US$10 GitHub Copilot Pro、不啟用 Copilot Cloud Agent／Automations**。現在使用五個 ChatGPT 對話人工喚醒並透過 GitHub Issue／PR 交接。本檔 Copilot 訂閱與設定步驟屬**歷史備用方案**，**不要照本檔啟用、付費或改 Repo Public/Private**。GitHub CI、main protection、審閱與安全環境 Gate 的規則仍有效；以 [AGENTS.md](../../AGENTS.md) 與 [HANDOFF-PROTOCOL.md](../ai/HANDOFF-PROTOCOL.md) 最新決議為準。

> 2026-10-26 台灣時間。適用 `starry-phd/id`，非 H-Global；依業主指示不採用 OpenAI Codex / OpenAI Platform API Key。
> 本文件及五個 .agent.md **只是可審閱的設定草案**。沒有證據前不得宣稱 Copilot 已購買、五組 AI 在背景執行、完整 App 測試通過或正式部署成功。

## 1. 已由工具實際驗證（讀取紀錄）
- Repository: `starry-phd/id`，PUBLIC，default branch `main`。
- Ruleset `Protect-main-Starry-ID`: https://github.com/starry-phd/id/rules/25839375 ，ENFORCED；所有 main 更動需 PR 與 status `Repository policy`，禁止 force push/deletion，沒有 bypass，0 mandatory approvals，要求解決 PR 討論。
- GitHub Issues: AI-0 #1，AI-1 #2，AI-2 #3，AI-3 #4，AI-4 #5；H-Global-only future interface #6 DISABLED。
- Previous Draft PR #7 (Codex API-key launcher) remains unmerged and its paid job is guarded by `false &&`；不要重新啟用。
- Cloudflare Starry Worker `id-starry` 的 Git 來源為 `starry-phd/id`、main；已核實 **auto_build_enabled=false**。其原 Production deploy command 仍是 `npx wrangler deploy`，重新啟用 Workers Builds 前必須審查。
- No root `package.json` / `package-lock.json` / working Starry app found on main; PR policy CI PASS is not an app/typecheck/lint/test PASS.
- GitHub Organization Copilot subscription, agents policy, Organization Actions setting persistence, Environment settings, billing usage limits, and secrets **cannot be independently read/modified via current GitHub connector**.

## 2. PR #9 的無 Codex 預備檔案
- `.github/agents/ai-{0..4}-*.agent.md`: GitHub Copilot Cloud Agent 可讀取的五個自訂角色設定；merge into main 才能在預設分支使用。
- `.github/workflows/starry-ci.yml`: PR／main 預設無密鑰、讀取權限的 CI。檢查 Starry 邊界、五角色設定、敏感檔名；之後有真實 App 鎖檔時執行 typecheck/lint/tests。
- `scripts/ci/validate_repository.py`: 輕量檔案檢查，**不是** GitHub Secret Scanning、SAST 或依賴漏洞稽核的替代品。
- Staging job：只有 main push、CI 的實際 app-tests SUCCESS、`STARRY_STAGING_ENABLED=true`、正確 staging environment secrets、Starry Worker scaffold 存在才可部署。當前預設 OFF。
- `.github/workflows/starry-production.yml`: 要求人類 `yukidu`、手動 dispatch、明確確認字串、main、`STARRY_PRODUCTION_ENABLED=true`、通過真實測試、production environment 才可部署。當前預設 OFF。**沒有開啟全自動 Production**。

## 3. GitHub 組織 Owner 必須在網頁核對（Connector 無 Admin/Secrets 寫入 API）
依序檢查，確認正確並儲存；僅允許本 Repo 與最低必要權限。

### A. Copilot 授權與 Organization Policy
1. Copilot 官方帳單方案：https://github.com/features/copilot/plans 。需獨立有效的付費 Copilot 使用資格；GitHub Team 和 ChatGPT Pro 不可直接替代。不要誤買五席：五個代理角色本身不等於五位人類用戶。
2. Organization Copilot policies: https://github.com/organizations/starry-phd/settings/copilot/policies （如實際 UI 不同，從 Org Settings > Copilot > Policies 進入）。
3. **Copilot cloud agent** Policy 設 `Enabled`；僅在需要 MCP 時啟用相應受控伺服器。不要授權不明的第三方 MCP。
4. Organization Settings > Copilot > **Cloud agent**: Repository access 選 `Selected repositories` 並只選 `id`，確認允許 agent 工作。
5. Org Cloud agent 的 `Allow automations` 可預備啟用；但本 Repo PUBLIC，因此 GitHub 原生 Copilot Automations **仍不能用**。改 Private 前先評估 Runner CI 計費／檔案機密性，不做未經確認的可見度修改。
6. Repo Settings > Copilot > Cloud agent: 保留內建 security & code quality validation；**建議保持 Requires approval for workflow runs**，直到確認無 Secrets 綁到 untrusted PR；不要為追求「全自動」直接關閉防護。
7. 把五個 `.github/agents` profile merge 到 default branch 後到 https://github.com/copilot/agents 選 `starry-phd/id` 檢查各角色確實出現。

### B. Repository & Organization Actions 權限
1. Org Settings > Actions > General：https://github.com/organizations/starry-phd/settings/actions 。
2. 設定 `Read repository contents and packages permissions` 作為預設 GITHUB_TOKEN，避免全域 Write；每一支受控 Workflow 明確指定自己的最小權限。
3. 如真有需要讓 GitHub Actions Bot 提交 Draft PR，可以啟用 `Allow GitHub Actions to create and approve pull requests`；這是允許能力，**不是**授權 AI 自我審查、自我合併。Copilot Cloud Agent 的授權與這項設定不同。
4. 不啟用 untrusted fork PR 的 secrets、`pull_request_target` 執行外來程式碼、全域寫入 Token、未受審查的第三方 Actions。
5. Workflow 僅依可信提交以 PR → CI → protected main → staging 操作；更動 Workflow 應由 Owner 在 PR 中特別審核。避免重複部署：後續主選 GitHub Actions 控制部署，Cloudflare Workers Builds 維持自動建置關閉直到發佈架構裁決。

### C. 安全／權限／稽核
1. 確認唯一 Owner `yukidu` MFA 已啟用；預防鎖住自己後才考慮 Org 全員 2FA。
2. `main` 的 Active Ruleset 不可移除；未完成 App 基座前只要求 `Repository policy`。當 App 真正建立且測試通過，再加 `App typecheck, lint and tests` 為必需檢查。
3. Repo Settings > Security / Code security and analysis：按方案支援情況啟用 Secret Scanning、Push Protection、Dependabot alerts／security updates／dependency graph；費用或限制先核對。
4. 不公開 Secrets、個資、正式客戶資料；不要把 Cloudflare API Token 放在 Repo 文件、Issue、PR、ChatGPT。
5. GitHub Actions 或 Copilot Agent 使用部署 Token 時，各自使用不同、短效且只限 Starry 的最小權限 token；不要複用 H-Global Credentials。
6. 避免 Auto-merge 及 0 審查等於「無人審核」的誤會：0 mandatory approval 只允許你單人合併，重大 Auth/Billing/Production 仍需 AI-0 Gate 和你的最終發布授權。

### D. Staging / Production environments
1. https://github.com/starry-phd/id/settings/environments 中建立 `staging`、`production`；均只允許 `main` branches；不允許 Admin bypass。未經工具驗證的設定需使用網頁截圖驗證。
2. staging 專用 `CLOUDFLARE_API_TOKEN`／`CLOUDFLARE_ACCOUNT_ID` 只在環境層級建立（不得放 Public Repo）；Production 必須使用不同、限縮授權的正式 Token。正式 Token 暫不建立／不注入，因為目前沒有 App scaffold。
3. Repo Settings > Secrets and variables > Actions > Variables：`STARRY_STAGING_ENABLED` 缺省/false、`STARRY_PRODUCTION_ENABLED` 缺省/false。兩個都 **不得預設 true**。
4. Staging 未建立真實環境和 Worker 之前不要啟用。Production 維持人工觸發，避免登入、會員、付款、資料庫出現不可逆錯誤。

## 4. 人員／代理啟動方式（不誤稱 AI 已醒）
- 聊天室中的另外四個 ChatGPT AI：它們不會被 Issue 自動喚醒，無法靠 GitHub Settings 開機。
- GitHub Copilot Cloud Agent（有購買並由 Org 政策允許後）：可在 Issue `Assignees` 指派 `Copilot`，選擇適當 `ai-4-expo-workers` 等自訂角色，單次任務在 GitHub 背景執行，產出 Draft PR；不需要 4 個人類帳號。
- 首次任務先從 #5 AI-4 建立 app scaffold + CI 開始。AI-1～AI-3 必須等待 API/schema 邊界契約就緒後再平行執行，以免造成衝突和重工。
- 真正事件／定時驅動原生 GitHub Copilot Automations：需 (a) Copilot paid entitlement, (b) Org/Repo enabled, (c) Private/Internal Repo, (d) Owner 設定 trigger/cost/permissions。PUBLIC 下不可預先聲稱已啟用。
- AI-0 不能依賴口頭喚醒。所有完成、失敗、待決事項放在 Issues/PR，附上 run URL 和 Commit SHA。

## 5. 發布 Gate
- Gate 0: 費用/政策/五個 profiles 在 default branch 真正可見；人工審查無未知 App。
- Gate 1: 正式規格及 Starry-only interface/ownership 核准。
- Gate 2: Node/TypeScript/lint/test 真正執行且通過，權限與秘密掃描無問題。
- Gate 3: 正確 Starry Cloudflare staging secrets；Staging URL 及回滾演練通過。
- Gate 4: 需要產品 Owner 核准才可啟動 Production/Store 發布，資料庫備份／回滾／監控就緒。

## 官方參考
- [Copilot 自訂 Agent](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [組織啟用 Copilot Cloud Agent](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/add-copilot-cloud-agent)
- [Copilot Automations](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-automations)
- [Copilot Cloud Agent Actions Workflow approval 安全限制](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings)
- [Workers Builds 分支部署](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
