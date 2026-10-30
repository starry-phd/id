# AI-3 M2/M4｜PITR 回退風險檢測：離線隔離演練 v0.1

**Status: SOURCE-ONLY / NOT A RESTORE AUTHORIZATION.**  
基準：main `7ad50e4ab658960b6042f031e23faa3ad32ec8d8`；[2026-10-30《最新開發技術規範》v1.0](https://docs.google.com/document/d/1urLja9i9A63jHuz4jQPhPMTgoCtoq-i1TafXPQd3PYU) UP-03/05/10/11/15/17/19/22、S2-08/09/10、[#220](https://github.com/starry-phd/id/issues/220)、已合 #270 的 M2 HOLD／待法律審查矩陣。

## 交付的確切新能力

`src/m2-offline-pitr-reconciliation.ts` 是**無副作用的離線復原風險分析器**，不是另一個 Queue/DB factory：拿受控、合成的「候選 PITR 資料快照」與**假設在另一權威取得的觀察紀錄**比較，輸出可供 M2/M4 測試使用的風險碼，不修改任一資料來源。檢查：

- 候選快照 generation 比 witness 舊；
- witness 紀錄已刪除的會員，在恢復快照中仍 active/suspended，或 Profile 又出現；
- `auth_version` 回退、舊版本 Session 未撤權、刪除後 Session 仍 active；
- 快照中帳號沒有相對應 witness 覆蓋；重複 member/session/witness、錯 app/env/brand、prod、可疑 accessors/symbol/未知欄位全拒。

所有結果 **`quarantined_review_required`**，且永遠 `may_restore=false`、`may_open_api=false`、`may_grant_battery=false`、`may_ack_queue=false`、`independent_witness_verified=false`。即使比較完全一致也**不能**批准恢復。

## 不能冒充的能力與正式驗收依賴

這個測試的「witness」只是由本機呼叫端傳入的**合成資料**；完全沒有保證物理獨立、簽章驗證、不可回滾性、完整成員覆蓋、操作者權限或合法持有資料，也沒有任何對真 D1、Queue、OAuth、備份或敏感內容的操作。

正式 anti-PITR 至少仍需要：AI-0/法遵決定 Q104/Q119 最小 witness 欄位、合法用途和保存期限、資料主體請求/第三方履行證據；AI-1 的來源權威發生版本/撤銷/刪除及交易內必要 outbox；AI-3 的可信已提交證據與授權重播；AI-4 核准的**實際獨立資料權威／存取與可恢復性**。隔離測試的 snapshot epoch 不是 D1 Time Travel 的真實版本證明，候選 restore 不得對外開放會員 API；恢復後必須重新做完整撤權與刪除 reconciliation，並測服務重啟／中斷／失敗／過期備份。

## 負面測試與回退

`test/m2-offline-pitr-reconciliation.test.mjs` 覆蓋原有 #270 HOLD 未測的**實際回退比較邏輯**：舊備份復活、活 Session、已刪 Profile、auth-version regression、缺 witness、跨品牌/prod、偽批准欄位/副作用函式、accessor side-effect、重複資料等。測試不創建 DB、Queue、Secrets 或付費資源，不修改 AI-1 Auth/AI-4 Worker/正式 Gate。

因為只有新增兩個 AI-3 專屬檔，合併後可用受審 revert 回退；無任何雲端變更可回退。待 AI-0 安全審查後才決定更進一步的實體復原/法律裁決。Battery 永久免費、首贈資格未驗 HOLD、Ads OFF；H-Global／Echo 不介入。
