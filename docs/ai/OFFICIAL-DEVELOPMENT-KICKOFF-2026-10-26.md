# Starry ID｜第一波正式開發啟動／五組 ChatGPT AI 人工喚醒交接（2026-10-26）

> **狀態：業主授權正式開發；GitHub 工作分配與交接已啟動。** 本文件不是 App 已寫好、CI 已跑過 App tests、Staging／Production 已部署的證據。
> 最新業主決議優先於歷史 Repo、Copilot 或 Codex 設定。

## 1. 正確 GitHub 身分與唯一 Repo

- **個人 GitHub 管理帳號**：`yukidu`。
- **組織**：`starry-phd`。
- **Starry ID 唯一正式新開發 Repo**：[https://github.com/starry-phd/id](https://github.com/starry-phd/id)，預設 `main`，公開倉庫；PR／main ruleset／CI 持續有效。
- **舊帳號 `starryphp` 已被封鎖，業主正式捨棄。** 不登入、不依賴、不建立任何 GitHub Remote、Secrets、Actions、部署或文件連結至舊帳號。不能從舊 Repo 複製未審核程式、金鑰或資料庫。
- 使用者口語稱「yukidu 組織下的 starry/id」，但 API 驗證 `starry/id` 不存在（404）；**不得猜測 Repo URL 或自行遷移**，以 `starry-phd/id` 為準。若業主未來指定新 Repo，須先核實後再更新正式決議。

## 2. 開發模式與安全邊界

- **AI-0～AI-4 是五個獨立 ChatGPT 對話，由業主人工叫醒**；GitHub 不會自動叫醒聊天，也不能保證對話關閉後持續執行。
- **不購買 Copilot Pro、不使用 Copilot Cloud Agent、Codex 或 OpenAI Platform API Key 自動開發**。先前 `.github/agents/` 只作備用角色說明，PR #7 保持未合併／禁用。
- **工程交接只寫 GitHub**：Issue、PR、commit SHA、CI run、OpenAPI/ADR；每組在當次對話讀 GitHub 最新狀態，完成後回寫。使用者不用在各 AI 對話人工轉貼整份交接包。
- **只准 Starry**。H-Global 全面暫停，且不可讀寫 H-Global Cloudflare、資料庫、會員或付款。
- **第一波** React Native + Expo + Expo Router + TypeScript + Workers／OpenAPI；**第二波** Starry 獨立 React + Vite + TypeScript + Tailwind + shadcn/ui + TanStack，已核准技術選型但**不啟動實作**（#15）。第一波需預留 ADMIN-PREP P01～P10（#13）。
- 一律安全 branch → Draft PR → 真實 CI → AI-0 Gate → 符合規範的 merge；**不得未經授權直接 Production、真實 D1 或扣款**。

## 3. 五組正式啟動工作單

| 角色 | GitHub Issue | 現在可以做 | 必須等待 |
| --- | --- | --- | --- |
| AI-0 總管 | [#1](https://github.com/starry-phd/id/issues/1) | 核對規格、定 API/資料權屬與驗收 Gate，審核 PR | 未經實證不可宣稱部署成功 |
| AI-4 基座 | [#5](https://github.com/starry-phd/id/issues/5) | **優先開始實際寫 Expo／Workers／OpenAPI／CI 基座**，Draft PR、真實測試 | 正式部署／金鑰／Production |
| AI-1 會員 | [#2](https://github.com/starry-phd/id/issues/2) | Auth／會員／管理權限契約與測試設計，可同步起草獨立規格 PR | 依賴 AI-4 基座的程式整合 |
| AI-2 Billing | [#3](https://github.com/starry-phd/id/issues/3) | Sandbox Billing/IAP API／權益／收據／退款契約、測試與風險設計 | AI-1 身分契約、AI-4 API 基座 |
| AI-3 Battery | [#4](https://github.com/starry-phd/id/issues/4) | 免費 Battery／通知／稽核／復原契約、事件 schema 與安全測試設計 | AI-1 Auth、AI-4 Workers 基座 |

## 4. 人工喚醒操作

1. 業主打開各專責 ChatGPT 對話，發出一句：「**開始正式開發 Starry ID。先讀 https://github.com/starry-phd/id 的 AGENTS.md、docs/ai/HANDOFF-PROTOCOL.md 和你自己的 Issue #X，再讀相關 PR／CI。依已核准需求在安全分支工作，完成後將 Draft PR／SHA／測試結果／阻塞寫回 GitHub。舊 starryphp 已封鎖棄用，GitHub 個人帳號 yukidu、組織 starry-phd、Repo starry-phd/id；H-Global 暫停、無 Copilot／Codex、不可擅自部署 Production。**」
2. AI-4 先做第一個可執行程式基座；AI-1～3 可以並行規劃 API／DTO，不要各自生成衝突的 monorepo／Workers 基座。
3. 每組結束當次對話前，必須在自己的 Issue 回報：已完成／未完成、分支、SHA、PR、CI、相依阻塞與下一步。若 GitHub Connector 無權限，先請業主補授權，不得聲稱已回寫。
4. AI-0 根據 GitHub 真實證據安排下一次人工叫醒次序與 Gate。**任何 Issue 的存在都不是 AI 已經開始運行的證據**。

## 5. 首輪驗收（尚待工程完成）

- [x] 業主授權第一波正式開發，確認唯一 GitHub Repo、人工叫醒工作模式。
- [x] AI-0～AI-4 各自 Issue 記錄新舊 GitHub 身分與首輪分工。
- [ ] AI-4 真正建立 Expo／Workers 可執行基座 Draft PR。
- [ ] GitHub CI 真正執行 App typecheck／lint／unit tests 並通過（不能用 repository policy PASS 取代）。
- [ ] AI-1 Auth／會員契約與安全測試、AI-2 Billing/IAP Sandbox 契約、AI-3 Battery／Audit 契約交付。
- [ ] AI-0 Gate 1 審閱所有模組接口／權限／安全／ADMIN-PREP P01～P10 及依賴。
- [ ] 經業主另行批准的 Staging／Production 部署（當前不授權）。

