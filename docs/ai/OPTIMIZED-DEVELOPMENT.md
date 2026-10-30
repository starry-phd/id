# 現行開發流程落實規則

## 現行臨時最高優先決議｜2026-10-31～2026-11-06「單一 AI 專注開發＋GitHub CI」七日試行

> 業主正式核准，記錄於 [Issue #220 的 2026-10-31 單 AI 試行令](https://github.com/starry-phd/id/issues/220#issuecomment-6531040275)。**2026-11-07 檢討是否延長或調整**。本節試行期間僅覆蓋下方及 AGENTS.md／HANDOFF-PROTOCOL.md／舊 Issue 中**「五位 AI 同時開發、各模組不同專責執行者、人工喚醒四個助手」**的分工與排程；原技術規格、歷史工程成果、版本化契約、Issue 編號、GitHub 保護及安全／法遵／發布 Gate 不變。試行期結束不自動恢復五 AI，應先評估成效並由業主決定。

1. **唯一主動程式實作者與工程協調者為 AI-0（使用者目前的 ChatGPT 開發對話）**，負責從既有 `main`、#220、相關 Issue #1～#5、契約與 CI 直接接手 Auth／會員、Worker／Expo、Billing、Battery、個資刪除及整合。**AI-1～AI-4 的獨立 ChatGPT 對話在試行期停止另行派工／建立競爭 PR；不需要業主逐一喚醒。** 仍保留舊角色、文件與原 Issue 作為歷史追溯和技術領域分類；若未來恢復多人需新正式工作令。
2. **一次只推一條有完整驗收出口的垂直功能切片、一個主要實作 PR**，優先 M1：在現存單一 Starry Auth/Session／本機 SQLite 程式之上，形成可安全驗收的**真正 Starry-only 受控測試登入 → 本人資料 GET → CAS PATCH → logout → 舊 Session 拒絕**。先處理真正缺件／接線，禁止為增加 PR 數重做 #279/#281/#293/#296/#297 或已合其他模組。若遠端 Worker/D1/Google OAuth／存取保護／成本／Secret Gate 不具備，停在 source-only 可驗收範圍且精確記錄阻塞，不冒稱已完成遠端登入。
3. **GitHub 是唯一工程事實來源**：#220 最新狀態、相關原 Issue 與 PR 明載基準 main SHA、變更路徑、測試、原生 CI run + exact HEAD、合併與合後 main push CI、分環境的實際結果及回退。不可因單 AI 改用聊天當永久交接庫；本對話需要使用者下次發話才會繼續，GitHub Issue 留言不會喚醒 ChatGPT，GitHub Actions 只會執行已設的 CI，不等於 AI 不間斷開發。
4. **不放寬任何品質門檻**：保留受保護 main、PR、`Repository policy` + `Required validation` 必要檢查、Node/TypeScript／SQLite／local workerd 真測試、相同 SHA 源碼／差異查核、合併後獨立 push CI。單 AI 的自我複查**不得聲稱為另一位獨立 reviewer**；涉及真 OAuth、金流、合法個資擦除、雲端安全等高風險操作，仍須符合原規範所需的獨立審核、官方／遠端證據、合法決策或人工核准。**CI 綠燈不等於安全／法遵／真實端到端／發布准入**。
5. **既有狀態不偷渡**：#289 Store S2-11 Draft 等政策／法遵尚未定的 PR 維持 HOLD；#282～#285 test-only 禁直接合 main；舊工作依現有成果接續，非刪除／重新開發。只處理 Starry ID，H-Global／Echo 暫停，Battery 永久免費、首次贈送資格 HOLD、Ads OFF。未經核真隔離資源／費用／Google OAuth／Access 或等效測試者阻擋／Secret custody／回退及具體授權不得建 Cloudflare 專用 D1/Worker 或部署；正式 `G00–G10` 11 項 BLOCKED、`release_authorization.granted=false` 持續保護，不能改成 release。
6. **檢討量化**：於 2026-11-07 根據 10/31～11/06 的 GitHub 證據比較「通過真正本機／遠端／裝置端完整功能驗收的切片數、從開始到合後 CI 的週期、同缺陷返工次數、業主操作負擔、11 項 release Gate 的真正缺件減少」，不以 commit／PR／測試總數假造功能完成率。決定繼續單 AI、改 2 AI 或恢復更多人，必須另記 #220。

基線：[最新開發技術規範 v1.0](https://docs.google.com/document/d/1urLja9i9A63jHuz4jQPhPMTgoCtoq-i1TafXPQd3PYU)，流程 UP-01～24 v3.0 優先於舊技術基座 v1.3 衝突條款。採用日期 2026-10-29。工程狀態只記 #220、專責 Issue、PR/SHA/CI。

## 切片與責任

先 GOV 流程落實，再 M0 guard／真測試與部署證據前置，再 M1 真會員登入→Session→本人資料往返。單一主 PR，AI-1 Auth/會員主責；AI-4 僅平台與契約審查；AI-2 Billing 在會員切片不平行擴建；AI-3 提早審查刪除／撤權／稽核與 PITR 風險。不重做 W1/W2/W3 或盲合 #263 的歷史完整樹。

後續工作令須標 owner、依賴、基準 SHA、允許路徑、驗收出口及實際執行狀態。審查以受影響 P01～P10、G00～G10 及契約對照為限，不為每個小 PR 重貼全套矩陣。D87 是單一交易權威，不代表全資料單庫；P05 欄位差異需來源裁定。

## CI 與發布

`Required validation` 使用 always() 彙總 Repository policy 與實際 App job，任一 failure/cancelled/skipped 都拒絕。既有 concurrency 保留。此工作流程檔無法自行修改 GitHub ruleset；只有查證 ruleset 將該 check 列為 required 後才稱強制生效，之前不得以 policy 綠燈代替完整 CI 驗收。

本 GOV 不改舊來源 pin／readiness validator，不把 blocked exit 0 當部署准入。下一 M0 PR 分離不可破壞發布條件、來源追溯與切片能力範圍；需結構化解析配置、未知／巢狀 env 負例及 readiness freeze 一併審查，不先刪 guard。

本機真 SQLite/HMAC、Workers runtime、remote D1、裝置及商店 sandbox 各自標環境；不能互代。證據記 exact SHA、版本、指令、CI URL、結果、保留與去識別化。不以 PR／commit／測試數計算功能完成率。

## 不變邊界

中央 Expo54/npm 維持至實際安全／支援需求；未來 consumer App 才另開私有 pnpm/Turbo monorepo。RevenueCat thin BillingClient、登入後購買、不跨 App 授權；AdMob 已選但 OFF，Battery 免費。候選套件不是強制依賴。帳號刪除最小路徑 M2，M0 提早考慮隱私／PITR。

合併／staging／production／store 分別驗收；既有 Cloudflare Builds 停用保護不隨 git revert 恢復。沒有本輪部署、真資源或付費服務啟用。重大變更用短 ADR，保留 UP 編號與被取代理由。
