# Starry ID｜五組 ChatGPT 人工啟動與新 GitHub 唯一交接入口
> **2026-10-26 業主正式授權開始新架構第一波程式開發。**
> Status: KICKOFF APPROVED / EXECUTION PER ROLE AND PR / NOT DEPLOYED
> 本檔只記錄 GitHub 組織身分與五組啟動邊界；不是正式上線或 AI 自動背景運行的證據。

## 0. 絕對優先：舊 GitHub `starryphp` 已由業主捨棄

- 業主明確告知：舊 GitHub ID `starryphp` 已被封鎖／捨棄。**不得再用它作為新專案帳號、Git remote、clone source、Issue/PR、部署或權限依據。** 舊倉庫只在業主個別授權下才可歷史參考，預設不查。
- **最新 verified canonical repo**：**https://github.com/starry-phd/id**，REST `full_name=starry-phd/id`。
- **GitHub Organization**：`starry-phd`（不是 `starryphp`、也不是 `starry`）。**個人管理者**：`yukidu`（授權連接器為 `yukidu@gmail.com`）。
- 倉庫：`id`；default/protected branch：`main`；Repo 為 PUBLIC；受 main ruleset/PR CI 約束。
- 業主口語「yukidu 組織下的 starry/id」以實際 GitHub 驗證為準：`starry/id` 於 2026-10-26 查詢為 404，**不可當正式部署倉庫**。
- Git URL：`https://github.com/starry-phd/id.git`；所有 GitHub Actions/PR/Contracts/Evidence 的 repository slug 使用 `starry-phd/id`。不得改為 `yukidu/id`、`starry/id` 或舊帳號 repo。
- **只進行 Starry**：H-Global 全部工作及其 GitHub／Cloudflare／D1／身份／金流目前暫停。未來跨品牌基本資料介面為 disabled mock/contract，不做 H-Global 實作。

## 1. 五組 ChatGPT（不用 GitHub Copilot Pro、Codex 或額外 API 費）

| 角色 | 人工啟動的 ChatGPT 任務 | 唯一任務入口 |
|---|---|---|
| AI-0（本對話） | 總指揮、模組邊界、核對權威需求、共享契約、Gate 與 PR 驗收 | https://github.com/starry-phd/id/issues/1 |
| AI-1 | Starry-only Auth/會員/權限；先完成契約、安全測試規格，再依可用基座實作 | https://github.com/starry-phd/id/issues/2 |
| AI-2 | Starry-only 數位 Billing/Apple+Google IAP；先 sandbox 契約與測試設計 | https://github.com/starry-phd/id/issues/3 |
| AI-3 | Starry 免費 Battery、通知、申訴、稽核、復原；先 event/audit 契約與測試 | https://github.com/starry-phd/id/issues/4 |
| AI-4 | **優先可執行工作**：React Native/Expo/Expo Router/TS + Workers/TS + OpenAPI scaffold、lockfile、typecheck/lint/test | https://github.com/starry-phd/id/issues/5 |

- 由業主**手動開啟四個其他 ChatGPT 對話**，各次說「先讀最新 GitHub Issue 及交接，開始／繼續開發」。GitHub 不會喚醒任何 ChatGPT 對話，也不會使其無人值守跑整夜。
- 各組可能並行完成各自的**需求/契約與不衝突的程式**，但共享 schema、migration、backend API/CI scaffold 必須先由 AI-0/AI-4 訂邊界，禁止四組同時修改同一檔案。
- **第一波已核准技術**：RN + Expo + Expo Router + TypeScript（iOS/Android 主、React Native Web 輔）、Cloudflare Workers + TypeScript、按需 D1/R2/Queues、OpenAPI 3.x。
- **第一波必備管理中心 P01–P10**：https://github.com/starry-phd/id/issues/13 與 `docs/contracts/FUTURE-STARRY-ADMIN-API.md`。第二波 V2.1 技術已核准、但**第二波 UI 不啟動**：https://github.com/starry-phd/id/issues/15 。

## 2. 一致的每次對話啟動程序

1. **先核驗 live GitHub** `https://github.com/starry-phd/id` 與身分 `yukidu`；不沿用任何舊 `starryphp` Repo/branch/PR/Secrets。
2. 讀 `main:AGENTS.md`、`docs/ai/HANDOFF-PROTOCOL.md`、本檔、對應 #1～#5 Issue、上游 PR/SHAs/CI run、#13 接口契約，以及第一波該領域**經業主審閱核准**的 DEV 文件。
3. 用 GitHub Issue 記錄當次開發前的 scope、依賴、風險和未決決議；需要 AI-0 Gate 才能修改 shared interface，業務規則未核准只提出提案不自動開發。
4. 在本倉庫獨立 `ai0/`、`ai1/`、`ai2/`、`ai3/`、`ai4/` 前綴分支提交可重現最小程式改動，建立 **Draft PR** 與真實 CI／本地測試、不可將空白 policy CI PASS 說成 App 測試 PASS。
5. 在自己的 Issue 和相依 Issue 使用 `docs/ai/HANDOFF-PROTOCOL.md` HANDOFF 格式寫 PR、Commit SHA、測試／CI URL、測試結果、阻塞及下一位 AI 的具體下一步。業主不用複製大量對話文字。
6. **Release Gate**：未經 AI-0 Gate 及業主核准，AI-1～4 不得自行合併 main 或發布 Production、寫正式 D1、建立 live 金流／訂閱、啟用自動部署；即使使用者說「正式開發」也不是「授權正式上線」。

## 3. 各角色獨立首輪交付（互不覆蓋）
- **AI-0 #1**：資料領域 ownership matrix、Auth/Billing/Battery API/event 合約依賴、P01–10 mapping；必要 shared-code PR 均以 Draft 待 Gate。
- **AI-1 #2**：獨立 Starry Auth/Session/Admin 授權的 type/interface & threat model；經核准後在 AI-4 base 上開發；包含未登入／越權／跨品牌／跨環境拒絕測試。
- **AI-2 #3**：IAP sandbox 商品/訂閱/收據/entitlement 的契約、idempotency/退款撤權測試方案；不要真實訂閱扣款或配置商店 Secret。
- **AI-3 #4**：免費 Battery 邊界、event/audit envelope、通知/重試/復原契約與測試方案；不加充值、錢包或付費點數。
- **AI-4 #5**：先做 package manager/lockfile、Expo Router 可跑頁面、Workers API base、OpenAPI skeleton、CI 真實 lint/typecheck/unit tests。PR 驗收後再給其他組更新 shared contracts。

## 4. 禁止與實際狀態
- **禁用** GitHub Copilot Pro／Cloud Agents/Automations（業主已撤回購買），原 `.github/agents/*.agent.md` 為未啟用備案；不使用 Codex／OpenAI Platform API Key，Draft PR #7 仍 PAUSED。
- 只可透過現有 `yukidu` 授權 GitHub 連接器修改 `starry-phd/id`；如某對話沒有該 GitHub 存取權，先回報權限問題，**不得改用舊帳號**。
- Cloudflare Workers Builds `auto_build_enabled=false`，Staging/Production 發布仍為安全 Gate；不可宣稱正式部署成功。
- 用 PR、SHA、CI／運行結果查證工作狀態；GitHub Issue 上的「已通知其他四組」只能表示指令已張貼，**不是四個聊天實際已醒或已動工**。
