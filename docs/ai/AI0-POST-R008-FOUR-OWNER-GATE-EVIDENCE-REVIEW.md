# AI-0｜POST-R008 四組新成果整合、跨 Gate 驗收及業主決策佇列（NO LIVE／NO DEPLOY）

**本文件是 GitHub-only 的獨立 AI-0 整合成果，不是業主批准、正式驗收通過或第九輪程式開發。** Starry 中央會員系統為唯一範圍；不碰 H-Global 或另一位 AI 負責的「繁星回聲」。所有來源 PR 維持 OPEN/DRAFT，main 不合併，Preview 不重啟，正式資源不變更。

## A. 原件與完整性
- R008 已完成之 **四 Owner 真正同一 SHA 離線驗收**：[PR #234](https://github.com/starry-phd/id/pull/234) `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9`、[同版 GitHub Actions](https://github.com/starry-phd/id/actions/runs/40745802066)：1,776 Node + 413 SQLite memory PASS；**Gate2 OFFLINE ONLY**，不重做。
- 最新 AI-0 GitHub-only 交接來源：[Issue #220](https://github.com/starry-phd/id/issues/220)／[PR #237](https://github.com/starry-phd/id/pull/237) `ac99611e00c32c0f5945fb9989807b0dd2dda1a9`。
- 四組皆從 #237 的同一 SHA 出發，這次新工作分別為：[AI-1 #239](https://github.com/starry-phd/id/pull/239) `7b543f6cc258733d6533c70cc3b6e141b1efe104`（G02/G03，2 原檔）、[AI-2 #240](https://github.com/starry-phd/id/pull/240) `6809172b4a29246d1c096ca5c371a16d5aab20c3`（G04/G05，2 原檔）、[AI-3 #238](https://github.com/starry-phd/id/pull/238) `620acc82702076812dd832cb59de00502d6357a3`（G07，2 原檔）、[AI-4 #241](https://github.com/starry-phd/id/pull/241) `a3a1cd2227e15327c3949cafac4d57197a192c72`（G08/G09，3 原檔含 9 個靜態完整性測試）。
- 本整合分支以 #241 exact HEAD 為父提交（因而繼承 AI-4 三個檔案），並透過 Git tree **直接引用** AI-1／2／3 的原始六個 Git blobs，不編輯原內容。隨附 `AI0-POST-R008-FOUR-OWNER-GATE-EVIDENCE-MANIFEST.v1.json` 逐項列出 9 個完整原始 blob SHA。
- 各 PR 原生同 SHA offline CI 均為成功：[AI-1](https://github.com/starry-phd/id/actions/runs/40750466048)、[AI-2](https://github.com/starry-phd/id/actions/runs/40750536441)、[AI-3](https://github.com/starry-phd/id/actions/runs/40750371263)、[AI-4](https://github.com/starry-phd/id/actions/runs/40750750164)；這些 **四個不同 SHA 的結果不是新 AI-0 整合 SHA 的驗收**，整合版須另看自己的 GitHub Actions。

## B. 正式 Gate（不能被交接清單冒充）
- Gate1 仍 **PARTIAL/BLOCKED**；Gate2 僅 R008 **OFFLINE PASS**；Gate3 官方 G00–G10 **11/11 BLOCKED**，每一項 `evidence=[]`，`release_authorization.granted=false`、`P05/PUBLISHABLE=false`。
- 官方 Gate JSON `docs/release-readiness/release-readiness.v0.json` 在未合併交接分支的 blob `0ea2e40692fb2e9f7e0c282ac1ece91ad2c740ba`，**已直接查 main 路徑回傳 404**，不可說它已進 main。
- AI-1 G02/G03：9 個前置批准依賴均待決；Apple/Google 官方 OIDC / 真 Session D1 無 live witness。
- AI-2 G04/G05：13 個前置批准要求均待決；真官方 Store / RevenueCat / Billing D1 無 live witness。
- AI-3 G07：8 個 evidence/readiness 項目全 blocked；Queue/DLQ/獨立 anti-PITR 無 live witness。
- AI-4 G08/G09：已列清真 Worker/SDK/Expo/EAS/裝置缺口與批准責任，**不是** staging build、受保護 API 或雙商店已成功。
- 此次 AI-0 只統整交付與核對來源完整性，**不**把 source-linked 文件或 CI 報告填入正式 release Gate evidence，也不把待批准的欄位改成 approved。

## C. 必須先處理的七項跨組裁決（按依賴順序）
| ID | 項目 | 現況／下一步 | 不能自行做的事 |
|---|---|---|---|
| D00 | **G00 中央 ID 範圍與 128 項溯源** | 最新 Issue #1/#2–#5 限制此五組為 Starry 中央會員；原 128 = 108+10+10 僅 heading 索引，已對照的 128 類別／25 seed registry 不等於核准最終 MVP；由業主核准具體中央 ID 里程碑、外部 App 排除/待決 | 啟動另一款 App、把 128 條標成全通過 |
| D01 | **G01 品牌／帳號隔離與 App ID** | 指定 Starry-only 中央測試 app_id／環境／資料擁有者／跨品牌拒絕驗收範圍；不動 H-Global 真資源 | 假設兩品牌已通過動態隔離 |
| D06 | **G06 P05 正式權威** | [#236](https://github.com/starry-phd/id/pull/236) 已比對「Admin 11 核心＋條件 idempotency」／Gate 未列欄位之 13／R006 離線候選 17；需業主與架構正式界定事件類別、欄位、版本、簽章/投遞 envelope 與第 13 欄的權威 | 猜第 13 欄、把 17 欄候選直接當發布契約 |
| D87 | **Issue #87 單一交易權威 A／outbox-saga B** | 決定 transaction ownership、跨 D1 不具原子性的失敗與回復語義、PITR/ACK/重播負責人；業主＋架構審閱 | 任選一案作為已核准、用 SQLite memory 代表實體跨 D1 |
| D104119 | **Q104/Q119 法遵與可刪除性** | 資料用途、保存期限、legal hold、撤權/清除/PITR 復活禁止須主管/法遵正式批准 | 擅定法律期限或使用真會員個資 |
| DTEST | **逐資源 Starry test-only 真實驗收授權** | 在上述前置核准後，提出官方 OIDC/Store/RC、隔離 Auth/Billing/Audit D1、Queues/DLQ、KMS/Access/Worker、EAS/裝置測試、明確費用上限/撤銷/稽核/回滾之**逐項書面批准** | 開 Preview、建真資源、呼叫官方 Sandbox/服務帳號、付費或部署 |
| D10 | **G10 營運與復原** | on-call、費用封頂/警報、Secrets、審計遮罩、資料刪除/保留、復原演練、Rollback 證據；Gate3 實證後獨立驗收 | 將文件評估等同生產 readiness |

## D. 有條件下一步（不自動喚醒其他 AI）
1. **現在可做**：本 PR 完整性、同版 CI、來源逐項審閱；D00／D06／D87／Q104/Q119 的裁決提案（明示未核准）。
2. **須業主先同意**：D00/G01 與正式 P05、跨 D1 A/B、法遵保留與刪除策略；對仍未確定的內容不以 AI 推論代替簽核。
3. **須第二次、逐資源明確授權才做**：AI-1~AI-4 的受控真實平台測試、Cloudflare Staging、D1/Queue、Apple/Google/RC/EAS、費用、機密憑證管理。
4. **另需上線明確授權**：才可合併 main、啟用 Preview、部署、修改正式 Gate、開啟 Ads 或金流。Ads 保持 OFF、Starry Battery 永久 FREE、Expo SDK54 不變。

**Rollback：**只關閉本 AI-0 Draft 並丟棄新整合分支；四位原 Draft PR #238～#241、R008 #234、交接 #237、main 與正式環境不受影響。

## E. 2026-10-29 業主已正式核准的架構方向（**補充本文件 C 欄歷史待決狀態**）

本文件前述 D06、D87 的「待決」為 POST-R008 整合時的歷史狀態；**以下為其後實際業主正式決議，優先於前述待決標記**，但均不構成 Live Gate PASS：

- **D87：方案 A 單一交易權威方向**。見 [Issue #1 #6478861308](https://github.com/starry-phd/id/issues/1#issuecomment-6478861308) 與 [決議 ADR](../adr/AI0-D87-STARRY-SINGLE-TRANSACTION-AUTHORITY-OWNER-DECISION-20261029.md)。決定跨模組**交易設計方向**；尚未核准實體 D1 數量、Schema、權限、真資源／費用、測試／部署。
- **D06：方案 A 共用業務事件核心＋獨立安全簽章／投遞封套分層方向**。見 [Issue #1 #6478960617](https://github.com/starry-phd/id/issues/1#issuecomment-6478960617) 與 [決議 ADR](../adr/AI0-D06-P05-LAYERED-EVENT-SECURITY-OWNER-DECISION-20261029.md)。原 ADMIN-PREP **11 核心＋條件性 `idempotency_key`** 是現有參考基線；release G06 提到但未列舉的「13 欄」權威仍未釐清；R006 **17-field 僅離線候選**，沒有因選 A 就定為正式第二層 Schema。正式版本、簽章/投遞/相容、域權威和個資法遵仍需獨立審查。
- **官方 Release 狀態完全不變**：G00–G10 **11/11 BLOCKED**、`evidence=[]`、`P05/PUBLISHABLE=false`、`release_authorization.granted=false`。AI-0／AI-1～4 不可自行啟動新工作或真實外部資源；main merge、Preview/Staging/Production、Secrets/D1/Queue/Store/EAS、付費均未獲核准。

## F. D00／G00 2026-10-29 驗收方法新決議：**A 分階段驗收**

業主新核准：[Issue #1 #6479057455](https://github.com/starry-phd/id/issues/1#issuecomment-6479057455)，對 A「先會員、登入、Session、權限，再依序 Billing、免費 Battery、通知及其他模組，保留所有原定功能」／B「全部中央功能一次整體驗收」選擇 **A**。

**Versioned ADR**：[D00 分階段驗收策略](../adr/AI0-D00-STARRY-PHASED-ACCEPTANCE-OWNER-DECISION-20261029.md)。本文件 C 欄 D00 的原始「策略待決」部分已由業主解決，**但正式 Starry 第一波 MVP 逐個 Source ID 的規格、例外條款、128 heading 衝突、真實平台證據仍未解決**。原已核准且符合最新 Starry 中央系統範圍的功能不得刪除，H-Global/第二波 UI/繁星回聲不得被分期策略偷渡。

每個階段只進行內部模組及相依安全 Gate 的驗收，**不是同意獨立分期部署／正式接收會員／發布**；G00～G10 依然 **11/11 BLOCKED**、`evidence=[]`、發布授權仍否、P05 不可發布。D87、D06 的架構方向 A 及其尚未核准的實作細節均維持前述 E 段。
