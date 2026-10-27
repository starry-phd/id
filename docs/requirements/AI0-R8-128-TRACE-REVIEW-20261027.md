# AI-0｜原始 128 需求首輪分類與 Gate 0 追溯（2026-10-27）

> **狀態：128/128 原始來源標題建檔＋原始 Google 主文件 128 章用途／限制／舊衝突標記讀取完成；對 DEV-A～I 專責文件的逐條語義裁決、本人逐項確認與真實環境驗收仍未完成。** 不能宣稱 128 項已批准、已開發、已發布，也不將舊紅字條款自動改為新版需求。

## 一、來源

- GitHub [original-inventory.v0.json](./original-inventory.v0.json) 原始 128 heading，主文件《第一波〈開發清單交接包〉》。
- [Q1～88](https://github.com/starry-phd/id/issues/1) 既有已核准決議、[Q89～125 集中交接](https://github.com/starry-phd/id/issues/1#issuecomment-6425664451) 及 [7 項 AI Gate 提案](https://github.com/starry-phd/id/issues/1#issuecomment-6425664451)。
- 已完成 [R7 四組離線整合 Draft #64](https://github.com/starry-phd/id/pull/64)，固定 SHA `e7ccf86483f1ea5515ac31b227f710d292289b4d`；[AI-0 同版 18/18 Actions SUCCESS](https://github.com/starry-phd/id/issues/1#issuecomment-6432205002)。此為 **offline evidence ONLY**。
- `registry.v0.json` 仍 `coverage=seed_only`；本分類矩陣不修改或覆寫正式原始庫及舊提案。

## 二、128 列狀態分類（**非**功能驗收進度）

| 分類 | 列數 | 含義 |
|---|---:|---|
| 有明確業主批准方向但 Release Gate 未過 | 54 | 最近的 Q 決議可支持此來源對應的產品方向；可能只驗部分 mock/測試，不代表來源全文都核准 |
| 部分批准／細節或完整來源條款尚待核對 | 39 | 依主清單或相關核准只涵蓋部分功能 |
| 已由新決議取代舊行為 | 8 | 不得恢復被覆蓋的舊約定 |
| 依政策暫停 H-Global | 19 | 只能記錄隔離或未來預留契約，不得開始真 H-Global 工程 |
| 暫緩第一階段 | 4 | 未列為首階段交付 |
| AI 建議，需 Gate 審查 | 3 | 業主沒有正式逐項選 A/B/C |
| 未取得業主明確批准 | 1 | 原標題不是核准 |
| **總計** | **128** | 來源索引完整；正式 G00 仍 BLOCKED |

## 三、Google 主文件 128 章原文核對標記（僅結構，不複製私人原文）

- 直接讀取原始 Google Docs 全文，**128/128 章節能與 GitHub 128 個 source_id 精確同序對上**。
- 128 章均找到用途描述；119 章有可辨識的獨立限制條款／同段限制敘述；**40 章含舊檔衝突／未核准推定標記**，不是自動批准。
- **3 處標題差異**：`12.05`、`N06`、`N07`；標記待語義核對，沒有擅自覆寫原主文件標題。
- 為避免在公開 GitHub 複製可能非公開的 Google Docs 正文，僅保存每章有無用途／限制／舊衝突及標題是否不同等欄位。
- 完整 DEV-A～I 對照及每條業主最終核准界線**仍需實施**；`source_clause_reconciled_count=0` 明確防止工程誤認為正式 G00 全審完成。

## 四、真正優先處理的差異

1. **07.08 永久免費額度不過期：** Q89=A 覆蓋舊「兩年到期、FEFO、到期提醒」；這些不能進入新 Battery 引擎。07.10 歷史合法封存單獨 Gate。
2. **07.03/07.06/07.07/07.09：** 已明確核准兩次贈送、可信固定任務費率、3 分鐘預留／結算、兩次受控透支；正式 X/Y、最高欠額、Server Task 成功權威、真 D1 CAS 還未 Gate。
3. **02.07：** 舊自動儲存被先前 Q13=B 明確存檔覆蓋；不得從主清單恢復自動儲存。
4. **05.01：** H-Global 舊「兩位最高管理者」不得複製到 Starry；Starry Q122=B 一位受保護最高＋分級授權。
5. **03.01～03.03／11.03：** Starry 首波無公開會員名片，Starry ID 是共用後端而非獨立上架商店 App；第一款真正消費 App 尚未命名。
6. **04.01～04.08／08.08/N05：** 教育中心、獎銜與 PAYUNi 實體票券屬 H-Global，工程全面暫停。
7. **Q104：** 業主有「不提供一般跨系撤回／自行解綁介面，通常以刪帳退出」的產品意向，但整批 Q104 留暫不決定；法定資料同意撤回與法律例外不得消失，跨品牌真連動仍禁用。
8. **Q119：** 刪帳新帳號可建立，但同一已驗證登入身份不能再次領取首次免費 Battery；跨帳號合法最小去重證據仍需 Privacy Gate。
9. **Q120/121/123/124/126/127/128：** 由業主授權 AI 提方案並列 Gate 的七項，不等於業主選 A/B/C。
10. **128 完整追溯：** 主文件 128 原始 heading 已在 `source-reconciliation-r8.v0.json` 與 candidate feature/owner/Q/PR/evidence/gate 一對一；**正文逐句條款、9 份 DEV A～I 的人工紅字衝突、真正商店及正式運行證據**仍待追加，不能自行將 `source_clause_review` 改為 done。

## 五、可重現驗證

`node docs/requirements/verify-source-reconciliation-r8.mjs`

- 同源逐列一致、不漏不重，128 個 ID/標題／章節相同，狀態合法。
- 所有列必須標示 `source_clause_review=master_section_read_dev_A_to_I_crosscheck_pending`，正式 `release_acceptance=blocked_real_environment_or_requirements_gate`。
- **嚴格防止**編輯器將此矩陣誤認 Gate 0 已解鎖。
- CI 為只讀測試，無任何 GitHub main 合併或 Cloudflare / Store / EAS / 真 DB / 付費動作。

## 六、下一步

- AI-0 自己進行正文層／DEV-A～I 條款級核對，核實例外、來源變更與覆蓋關係；每列帶正式「條款核對狀態」後才改 Gate 欄位。
- AI-1～4 繼續由業主喚醒後在獨立 Draft 實作，以上一版 **R7 #64** 的真固定 HEAD 為共同基準；下一個程式碼階段只處理核准項目。
- 任何開發、練習或 Actions 綠燈都不解除正式 G00～G10；不得在未經批准情況下合併 main、部署任何環境、真 D1、OAuth、Store 或 EAS；H-Global 暫停。
