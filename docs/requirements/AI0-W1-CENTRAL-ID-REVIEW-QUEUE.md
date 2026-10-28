# AI-0 W1：中央會員優先需求審查佇列
日期：2026-10-29（台灣）。Owner：AI-0；Issue #1/#220。本文件是工程審查排序，不是128條正文核准或正式Gate證據。

## 實際問題與解法
舊 registry.v0.json 是25項 seed，implementation 全寫 not_started，不能描述現有R008離線成果；128項 original inventory 也只是heading。直接據此派工會重做舊功能，或把autosave、跨品牌SSO等被取代內容復活。
新增唯讀工具 ai0-w1-review-queue.mjs，把GitHub既有原始索引與R8逐列decision class精確連接，保留每項source ID、title、決議參照與處置。不覆寫歷史檔，不從舊implementation欄推定現在完成度。Git blob pins要求來源完全一致；來源升版需另經審閱更新pins。

## 執行
`node docs/requirements/ai0-w1-review-queue.mjs` 在stdout產生JSON，無網路、資料庫、外部行動或檔案寫入。
`node --test apps/api/test/ai0-w1-review-queue.test.mjs` 驗證真128項來源與來源損壞/重複/未知/標題漂移負測。此test在現有root npm test glob中，不更動CI。

現有固定來源產出：22項P0中央會員審查、12項P0支撐審查、19項H-Global暫停、4項既有暫緩、71項保留待後續範圍審查。128項無遺漏、不刪功能。
P0中央會員候選範圍為01.01–01.08、02.01–02.04、02.07–02.10、05.01、05.04–05.06、05.08–05.09；P0支撐為P01–P10與N01–N02。這是AI-0依D00做的審查排序，非上述條款全部已准。
01.05、02.07、05.01雖需P0審查，仍保留superseded_by_latest；不能實作原跨品牌SSO、autosave或兩位Starry最高管理者。19項暫停及4項暫緩以來源分類優先，不能被P0集合覆蓋。未知future class顯示unrecognized_class並保留所有授權false。

## 源與已核准方向
- 基準Draft #242 `22d7ab1c127546e9e131810d58fdf7e0ccb17882`。
- original-inventory.v0.json Git blob `7a3131bc1a92d73145091a8bae51cb4aa135780c`；source-reconciliation-r8.v0.json Git blob `13f386a9c1defd2ac945e2235f5e237bafa07057`。
- [D00分階段驗收](https://github.com/starry-phd/id/issues/1#issuecomment-6479057455)。
- [D87單一交易權威](https://github.com/starry-phd/id/issues/1#issuecomment-6478861308)。
- [D06分層P05](https://github.com/starry-phd/id/issues/1#issuecomment-6478960617)。
R8映射保留其歷史決議標籤，但semantic approval仍pending，工具不將其轉成已核准正文，也不將歷史evidence_prs當新基準。
D87/D06最新方向須另外一起閱讀，不以舊R8內文重新詢問已決A/B。工具不生成P05第13欄、不建立schema或writer。

## AI-0收件與下一手
AI-1/3/4先利用P0清單對照現有程式與契約，報告確切缺口；AI-2處理D87 Billing邊界。Owner自有W1工作令已發布於#2–#5，目前未證實被執行。工具的成功不會把派工改成執行、也不能代替Owner code review/CI。
對每個P0項需審：最新有效條款、已存在程式與測試、缺失接口、跨模組owner、真平台證據需求。實作已有離線證據時重用；unknown則明列，不把heading當完整規格。共享runtime變更仍由AI-4在契約審閱後執行。

## Gate與回退
所有輸出g00_pass/p05_publishable/release_authorized=false；每項clause_semantics_approved_by_this_projection/live_verified/may_execute_external_actions/release_authorized=false。正式release JSON、Owner原件、Worker/SDK/部署配置無變更。
這不是新的mock功能輪次。新增工程工具六項測試驗證實際來源資料，不增加Live能力。
不合main、不部署、不建真資源/Secrets/啟用付費，不介入H-Global或繁星回聲；Gate G00–G10仍11/11 blocked。回退為關閉此獨立Draft並棄置三個新增路徑，#242/main均不改。
