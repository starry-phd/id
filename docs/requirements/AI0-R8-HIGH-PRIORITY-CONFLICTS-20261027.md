# AI-0｜R8 來源條款重大差異裁決（2026-10-27；以業主最新已核決議優先）

> 本表對照「第一波《開發清單交接包》」主 Google Docs 及 DEV-A～I 同編號條款；只保存差異性質與處置，**不複製私人原文**。來源文件的「人工審閱未勾選」或「舊檔衝突」標記仍須區分於已核准業主 Q 題。
> 這是**高優先風險條款**裁決，不代表 128 條全文語義核對結束，亦非正式 Release Gate。

| source_id | 源文件差異與已核准決議 | AI-0 處置 | Owner | 真正 Gate |
|---|---|---|---|---|
| `02.07` | 主文/DEV-E 原有離欄**自動儲存**，後續 Q13=B 決定按**儲存**才提交 | `SUPERSEDED`：不得還原 autosave；只以後端確認成功顯示保存成功 | AI-1 | profile E2E 與安全衝突覆寫 |
| `03.01` | 主文/DEV-E 建議**公開電子名片**；Q9=C/Q12=B 首波不提供公開名片 | `DEFERRED`：不建立匿名可讀個資頁；登入會員搜尋是獨立功能 | AI-1 | 公開路由不存在／搜尋不洩漏 Email |
| `05.01` | 主文/DEV-F 設 **H-Global 兩名最高管理者**；Starry Q122=B 為**一名最高＋分級** | `BRAND_SPLIT`：保留 H-Global 歷史規則但工程暫停，不移植到 Starry | AI-1 | Starry supreme 唯一性與不可跨品牌提升 |
| `05.08` | DEV-D 舊中央刪帳可跨品牌；新 Q88/Q97 必須 Starry/H-Global **各自刪帳** | `SUPERSEDED`：只撤銷 Starry 權益/Session，另一品牌不被刪除 | AI-1 + AI-3 | 刪帳、帳本/退款與防復活 |
| `06.07/N04` | 主文/DEV-G 曾提出跨系**非同步推送同步**；Q87=A Starry **不儲存 H-Global 欄位值** | `SUPERSEDED_FOR_FIELD_DATA`：未來核准才可**即時查詢/修改 H-Global 權威**，禁止原始欄位長期複製，工程現在 OFF | AI-1 + AI-4 | 合法同意、雙端受權、Q104 法遵解決 |
| `07.03` | 舊來源寫「首次核准／活動贈送」和示意 X=10/Y=20；Q90=A、Q109=A、Q110=A 指**註冊＋首次成功 AI 任務**贈送，數值須管理配置 | `PARTIAL_SUPERSEDE`：舊核准與測試示意數額不可當上線定值 | AI-3 | 真任務成功權威、X/Y 發布核准、跨帳戶防重合法性 |
| `07.08` | 主文/DEV-A 原有**兩年期限＋月底到期＋FEFO**；Q89=A 免費電池**永久有效** | `SUPERSEDED`：免費 Battery 不得再計到期或 FEFO | AI-3 | 非到期引擎、老測試不復活 |
| `07.09` | 主文/DEV-A 透支兩次一度標舊未核准；Q92=B/Q100=B/Q111=A 現已核**兩次受控透支、清償重置、單次限任務所需** | `LATEST_OWNER_APPROVED`：不得採無限透支；總欠額上限仍待安全 Gate 設定 | AI-3 | 併發雙扣/透支上限/清償一次性 |
| `07.10` | 舊三個月前到期提醒和 D1→R2 一年封存寫在同項；Q89=A 已取消到期 | `PARTIAL_SUPERSEDE`：取消到期提醒，帳本封存仍列 AI 提案 Q121，未取得正式保留期限核准 | AI-3 | 資料保留法遵和備份還原 |
| `08.08` | DEV-C 寫歷史**藍新金流**；主文新版為 H-Global **PAYUNi**；兩者不是 Starry IAP | `HGLOBAL_PAUSED`：以新 PAYUNi 方向封存待 H-Global 獨立案，不在 Starry repo 建票券流程 | AI-0，未來 H-Global Owner | H-Global 專責商戶／正式許可 |
| `09.08/N03` | 主文/DEV-H 明確要求依法撤回同意；業主 Q104 單獨口頭自訂 D「綁定後不提供一般撤回/解綁 UI」，整批後來 `104=暫不決定` | `LEGAL_GATE_PENDING`：常規身份解綁可受限制，但法律資料主體撤回/刪除權必須保留安全途徑；跨系禁用 | AI-1 + AI-0 | 合法同意版本／請求程序、正式上線前法遵 |
| `11.03` | DEV-I 原列中央 ID App、starry-echo、H-Global；主文說這些是舊清單，Q105=A **Starry ID 只是共用服務** | `SUPERSEDED`：不自動創建 Starry ID 商店 listing，首款消費端 App 尚未指定 | AI-4 + AI-0 | 真產品選定、bundle/SKU/商店驗收 |
| `12.05` | **直接來源衝突**：DEV-I 稱雙 Auth「仍待決」；後續主文件與業主採納**雙獨立 Auth／user ID** | `LATEST_MASTER_APPROVED`：後來核准的新主文與 N02 覆蓋舊 DEV-I，兩品牌資料庫／身份不得互認 | AI-1 | Auth/Secrets/D1/Session 對品牌隔離 |
| `N09` | 原主文與 DEV-A 寫 Battery 詳節尚未核准；Q86/89～112 已多題逐項核定 | `LATEST_OWNER_APPROVED_PARTIAL`：定價／預留／透支／贈送產品方向已定；實際數額、真 DB、法律不冒稱已完成 | AI-3 | 一切實環境 Gate |

## Gate 與追蹤界線
- 每列新增的只是**高風險來源衝突裁決**，目前 128 筆索引狀態不會被自動整批改成 approved/implemented。
- AI-1～AI-4 必須以 [R7 四 Owner 整合 Draft #64](https://github.com/starry-phd/id/pull/64) 的固定 SHA 作後續離線程式基準；本 R8 PR #65 只修改需求追溯資料，**不替換四位 Owner 程式**。
- **Release G00～G10 11/11 BLOCKED**；禁止合併 main、任何部署、真正 OAuth/Store/D1/EAS、H-Global 開發或付費。
