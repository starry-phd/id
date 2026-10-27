# Starry ID｜AI-0～AI-4 GitHub 開發與 CI 優化正式交接 SOP（2026-10-27）

> **文件狀態：AI-0 開發作業標準（Draft PR #70 分支待合併）。** GitHub 為程式碼、需求、決議、Commit SHA、CI、PR、驗收與分工的唯一跨對話事實來源。此文件不是發布許可，也不使 ChatGPT 的多個對話自動互相執行。  
> 適用：`starry-phd/id` 的 Starry 生態 AI-0、AI-1、AI-2、AI-3、AI-4；**H-Global 工程維持暫停**。如往後業主另有明確指示，以最新獲核准的 GitHub 決議、Gate 與該次授權為準。

## 1. 本次實證與改善範圍

- [第七輪 AI-0 真正四組整合 PR #64](https://github.com/starry-phd/id/pull/64)：同 SHA 18/18 GitHub Actions 工作流程成功，核心 CI [#40438157401](https://github.com/starry-phd/id/actions/runs/40438157401) 從 runner 日誌可見約 35 秒；先前整合使用大量逐檔 GitHub Contents API，**26 個 Owner 檔案連同 AI-0 異動形成 29 個 Git Commit**。此方法不符合「整批一次到位」的效率目標。
- [第八輪追溯 PR #65](https://github.com/starry-phd/id/pull/65)：同 SHA 6/6 工作流程成功，來源 CI [#40439644921](https://github.com/starry-phd/id/actions/runs/40439644921) 約 7 秒。
- [CI 優化 Draft PR #70](https://github.com/starry-phd/id/pull/70)，最初一次完成 **24 個檔案變更／單一 Commit `722229351c9b64bb0c26b1e3e810e57610238f69`**：13 份過期整合流程改為手動觸發、8 份現役專責工作流程補 `concurrency.cancel-in-progress`、新增單一完整 offline Gate 與防護檢查。其原始固定 SHA 實際 **7/7 workflow `completed/success`**（最新每次修改仍須重新讀取新 SHA）。
- GitHub 並無 R7／R8 工作流程卡住半小時的直接證據；大量**串行 GitHub 工具操作**是合理的低效率風險，但尚無 ChatGPT 執行 trace 可以證明 AI 對話／手機 UI 卡住的唯一原因。CI 精簡不能保證修復 ChatGPT 聊天介面停滯。
- #70 仍是 **open Draft / 未合併**；GitHub Actions YAML 在該候選分支可運作，不代表 `main` 或先前 AI-1／AI-3 分支已使用新設定。

## 2. 工作原則：整批完成、單次批次提交

1. 先讀 GitHub **Issue #1 總指揮／已核准決議、最新已驗證 AI-0 整合 PR 與固定 HEAD SHA**，再讀自己的 owner Issue、已完成 Draft、最新 CI；不可僅憑聊天敘述、舊 PR 號碼或工作流程綠燈猜測目前基線。四位 AI 各自於其專屬對話收到使用者指令後才開始工作，**沒有跨對話背景自動執行**。
2. 清楚列出本輪**交付檔案、owner 邊界、跨模組依賴與負向驗收**，先一次讀齊相依檔案，避免重讀大量來源。AI-1 Auth／會員／權限；AI-2 Billing、Store／SKU；AI-3 免費 Battery、通知／申訴／稽核；AI-4 Expo／App／Worker／OpenAPI／SDK；AI-0 跨組版本、128-source 對照及 Release Gate。
3. 需要新增或修改多個 GitHub 檔案時，**優先使用 Git Tree API 的批次變更**：對照 `base HEAD commit + base tree SHA` → 一次提交所有需改的 `tree_elements` → `create_tree(base_tree_sha)` → `create_commit(parent_sha)` → `update_ref(expected_sha=舊 head, force=false)`。處理同路徑衝突時先停止並核實最新 HEAD；**不得 force push 覆蓋其它 AI 工作**。若執行環境與 API 限制不允許批次工具，使用等價單次 `git commit`／PR 流程，並據實記錄例外。
4. **一次完整交付**：優先一個安全獨立 branch、一個清楚審閱的 Commit（必要修復可後續補 Commit）、一個 Draft PR，附來源 PR/SHA、差異摘要、真實 CI、未驗 Gate、交接給哪個 owner。避免每個文件各做一個 Commit，也不要為節省呼叫而省略測試或權限檢查。
5. **Owner code 不擅自互改**：跨組契約透過 Issue、固定 PR/SHA 與負測交接。AI-0 在新的隔離整合分支匯入各 Owner **實際來源內容**，核對同版 SHA／逐檔內容、衝突和回歸，**不能將 4 個不同版本各自綠燈直接當作同一 checkout 通過**。
6. **不強制固定 branch→PR→Preview→main→Production 流程**；開發階段仍以獨立 Draft／離線 Gate 保護為預設。合併與部署依業主當次授權、Release Gate 及必要正式安全檢查決定。

## 3. GitHub Actions 最佳化規則

| 類型 | 執行時機 | 規則 |
| --- | --- | --- |
| 最新完整 Offline Gate | 相關程式／規格／workflow 的 PR（目前候選檔 `.github/workflows/ai0-current-offline-gate.yml`） | 同一 checkout：locked dependencies、原始 128 來源及 R8 結構、G00～G10 仍 BLOCKED、Auth/Billing/Battery/App 的 TS／Node 負測、SQLite memory、Expo config、Wrangler **dry-run**。不可冒充真 OAuth/Store/D1/EAS |
| AI-1／AI-2／AI-3 專責及狹義 API／需求 Gate | 各自改動對應路徑時 | 保留領域安全測試；`concurrency` 以 workflow + PR 區分，`cancel-in-progress: true` 只取消**同一個 PR 的舊 SHA**，不得取消其它 PR 或漏跑最後 HEAD |
| 歷史 AI-0 R2～R6、AI-4 Foundation～R6（13 份） | **手動 workflow_dispatch** | 不自動隨每個 PR 重跑全套歷史 Gate；仍保留其檔案、檢查與歷史證據，需要調查才手動重跑 |
| `main` 必要檢查 | 原有 `starry-ci.yml` | **保留 `Repository policy`、main 既有 ruleset**，任何新 CI 不能取代/移除此必要檢查 |
| 正式環境／付費 | 原有 Production 安全入口 | **保持人工授權與 Release Gate**。即使同版 CI 綠燈也不觸發真部署／付費／Secrets／D1/Queue/EAS |

- 批次 CI 的主要目標是減少冗餘與浪費；**不假定**固定節省幾分鐘、幾美元，或 ChatGPT 回話必然較快。
- `node docs/operations/verify-ci-consolidation.mjs` 必須通過；所有修改後要查**最新 PR HEAD** 的 workflow runs、job/steps，精確回報 `completed/success/failed/cancelled/pending`，不得引用舊 SHA 冒充通過。
- `cancel-in-progress` 只取消過時工作流程：**如果最新 SHA 的必要檢查未完成，仍不能認定整合 PASS**。
- 避免在 workflow 中調用 `EAS Build/Update/Workflows`、Cloudflare 真部署、真 Store 購買、正式 D1/Queue、付費 API。現有 `npm run api:check` 僅 `wrangler deploy --dry-run`；真正部署需要另外授權。

## 4. AI-1 / AI-3 對話「15 分鐘以上沒回應」的處理

**GitHub 不等於聊天狀態監控**：只能確認最後 PR／Commit 時間、最新 Actions 是否佇列/執行/失敗，以及 Issue 交接內容；無法由 GitHub 判斷 ChatGPT 是否卡在連接器、模型推論或手機介面。也不能在其它 AI 對話未被喚醒時，從本對話強制它們繼續。

發生長時間沒有可見更新時，AI-0 應：
1. 先讀最新 owner Draft HEAD、Commit、Issue 交接及該 SHA Actions 狀態／必要 job 日誌，**不要自動重跑**已成功的測試。
2. 若所有相關 GitHub CI 均 `completed/success`，明確回報「**GitHub CI 沒有阻塞證據**」；不能武斷宣稱是 GitHub 設定或 ChatGPT 故障。
3. 若 CI 失敗／排隊，指出 workflow/job/固定 SHA/具體失敗，再針對失敗源修正；不得混淆其它 PR 的 CI。
4. 若 UI 仍持續執行且使用者無法與該 AI 互動，由使用者在**該對話**選擇停止後重啟，指示它先讀 GitHub 固定 PR/SHA、跳過已完成工作、說明目前阻塞，再繼續。必要時用新對話恢復，**GitHub 已提交的內容仍保存**。
5. 本 AI-0 可以在實際可用的聊天執行時間更新進度；但無法保證第三方連接器阻塞時每 20 秒一定能發訊，也沒有跨對話即時監看能力。**進度回報以可驗證成果為準，不提供未做完就宣稱完成的更新**。

當時已查證 AI-1 [R8 Draft #66](https://github.com/starry-phd/id/pull/66) 同 SHA **8/8 GitHub Actions success**、AI-3 [R8 Draft #69](https://github.com/starry-phd/id/pull/69) 同 SHA **8/8 success**；當下並沒有這兩份 PR 的 GitHub CI 仍在等待的證據。當時新優化 [#70](https://github.com/starry-phd/id/pull/70) 尚未合併，也無法自動追溯修復前兩個對話。

## 5. 每輪最小 GitHub 交接格式（供各 AI 直接遵守）

```text
工程 Owner / 任務 / 對應 Issue：
業主核准需求（來源 URL + 決議）：
基線（已驗證 AI-0 PR + 固定 HEAD SHA）：
本次交付（Draft PR、branch、固定 HEAD SHA、異動檔及 owner 邊界）：
同一固定 SHA 的 Actions runs／Node、SQLite／負測實際結果：
跨 Owner 需要的 API/DTO/schema/身份授權交接：
尚未完成或 BLOCKED 的 Gate／法律／成本／正式環境：
main／Production／Secrets／金流／H-Global 是否觸碰：否
下一步：
```

## 6. 禁止跨越的 Gate

- 所有正式 G00～G10 **11/11 BLOCKED**，`PUBLISHABLE=false`；沒有正式 Apple/Google OAuth、Store receipt/IAP、Cloudflare 真 D1／Queue、EAS 實機/商店驗證可推論已完成。
- 禁止自行合併 main、部署 Cloudflare Preview/Staging/Production、修改正式 OAuth/Secrets/D1/Queues、啟用真 Store／付費、EAS Build/Update 或 H-Global 真連動。需要業主新的明確授權與 Gate 驗收。
- Q104 同意撤回合規、Q119 刪帳後合法防重發放、Battery X/Y 和費率/透支上限等尚未通過的條件須保留明顯阻塞標記。
- **GitHub 是長期 SSOT，ChatGPT 對話不是排程器也不是可保證即時的後台執行代理**。

## 7. 相關紀錄

- [AI-0 總管 Issue #1](https://github.com/starry-phd/id/issues/1)
- [CI 實際優化 Draft PR #70](https://github.com/starry-phd/id/pull/70)
- [已建立的 CI 精簡與還原證據](./CI-CONSOLIDATION-20261027.md)
- [AI-0 第七輪同版四組整合 PR #64](https://github.com/starry-phd/id/pull/64)
- [AI-0 第八輪需求追溯 PR #65](https://github.com/starry-phd/id/pull/65)

**注意：本 SOP 檔新增至 #70 的安全分支後，仍須以新增後的最新 HEAD 查驗 CI；該 PR 未合併前，不代表 main 已採用以上工作流程。**
