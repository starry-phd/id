# Starry CI 精簡方案｜2026-10-27（AI-0）

> **草稿／不合併／不部署**：只調整非正式環境的 GitHub Actions 工作流程觸發與並行取消；不更動程式功能、秘密、正式 D1、金流、商店或部署權限。

## 原因與證據
- 2026-10-27 GitHub [R7 PR #64](https://github.com/starry-phd/id/pull/64) 固定 SHA 有 18 個 workflow 觸發且通過；R8 PR #65 固定 SHA 6 個 workflow 觸發且通過。
- R7 新整合 Gate run #40438157401 實際 runner 約 35 秒、R8 來源驗收 run #40439644921 約 7 秒。不能將聊天介面長時間無反應單獨歸咎 GitHub Actions。
- 過去 AI-0 逐檔整合 26 個 Owner 檔案曾產生約 29 個 commit。優化建議為後續採 **單一次 Git Tree 多檔 commit + 經 SHA 預期值的非強制 branch 更新**，不要反覆逐檔 contents-api commit。

## 實際變更
1. AI-0 R2～R6 與 AI-4 Foundation～R6 **共 13 個歷史 workflow** 由寬鬆的 `pull_request.paths` 改成 **僅 `workflow_dispatch` 手動觸發**；保留各自原始測試 job、代碼、最小權限與可供追溯的歷史 CI。
2. 新增 `.github/workflows/ai0-current-offline-gate.yml`：每次有相關程式、規格或 Workflow 異動時只啟動 **一組最新完整離線整合 Gate**；跑 R8 128 筆來源結構驗證、G00–G10 release blocked preflight、四 Owner 嚴格 TS／Node 負測、SQLite :memory:、Expo／Wrangler dry-run。GitHub Actions 不呼叫部署／付費。
3. 8 份現役狹義領域／審查 Workflow 補上 `concurrency` 與 `cancel-in-progress: true`，每一 workflow 按 PR 號區隔，只取消**同一工作流程同一 PR 的過時版**，不任意取消其它 PR 的測試。
4. `starry-ci.yml` 的 required **Repository policy**／main 保護、以及 `starry-production.yml` 的正式部署人工輸入 Gate **完全不改**。AI-1/Billing/Battery、需求源追溯專責 Gate 等依路徑繼續運行，不能把歷史 Workflow 停用誤當作取消所有安全測試。

## 驗收與可回復
- 執行 `node docs/operations/verify-ci-consolidation.mjs` 自動檢查 13 個歷史 Workflow 沒有自動 PR/Push 觸發，最新整合 Workflow 保持 contents read-only 與 release blocked，`Repository policy` 與 Production 手動發布 Gate 保留。
- 由新 Draft PR 當下 HEAD Actions 確認同 SHA SUCCESS；未完成前只能說 **CI OPTIMIZATION DRAFT**，不能聲稱已生效於 main。
- 如需重開歷史 Workflow，可在經人工審核的獨立分支，還原本 PR 修改前的 YAML 內容；此處沒有刪除過往 CI 或 Action Log。
- GitHub Actions 用量可望降低**重複觸發**，但不能承諾特定速度與費用，手機 ChatGPT UI 無更新不等於 GitHub CI 故障。

## AI 開發作業 SOP
- AI-0～AI-4 後續交接及整批開發，請以 [AI-DEVELOPMENT-SOP-20261027.md](./AI-DEVELOPMENT-SOP-20261027.md) 為正式作業指引。此文件與本 CI 精簡驗證紀錄同屬 Draft #70，尚未合併 main。
