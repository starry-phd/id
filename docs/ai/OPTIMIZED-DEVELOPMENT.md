# 現行開發流程落實規則

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
