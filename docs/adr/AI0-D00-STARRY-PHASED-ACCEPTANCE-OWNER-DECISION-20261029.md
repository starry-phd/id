# AI-0 D00／G00｜Starry 中央會員系統「分階段驗收」業主正式決議（2026-10-29 台灣）

> **正式狀態：`OWNER_ACCEPTANCE_STRATEGY_A_PHASED_APPROVED`；不是 G00 需求 SSOT 已驗證，也不是發布或資源授權。**
>
> 業主面對 A「分階段驗收：先完成會員、登入、Session、權限等中央核心驗收，再依序驗收 Billing、免費 Battery、通知及其他模組。所有原定功能保留」及 B「整體驗收，中央系統功能全部達到驗收條件後才認定第一階段完成」的明確選項，**直接選 A**。
>
> 正式決議：[AI-0 Issue #1 #6479057455](https://github.com/starry-phd/id/issues/1#issuecomment-6479057455)；目前 AI-0 四組整合候選：[OPEN/DRAFT PR #242](https://github.com/starry-phd/id/pull/242)。

## 一、批准的驗收方法：分階段、逐模組

**Phase 1 — Starry 中央會員 Auth／身分核心先驗收**：會員、登入、Session、權限／撤權相關的正式規格與安全驗收優先；AI-1 專責、AI-0 驗證，其環境／安全／OpenAPI/SDK 必要共同相依仍納入此階段驗收，不能把純離線成功誤認為 Apple/Google OIDC、D1 或真平台完工。

**Phase 2 — 中央 Billing／訂閱、實體商店權威及支付權益相依**：AI-2 專責，涉及真 Store/Sandbox、RevenueCat、Billing D1、退款／重放、跨域交易一律仍需權威證據與逐項授權；Starry Battery 不得變成付費商品。

**Phase 3 — Starry Battery 永久免費、通知／稽核／復原及其他已核准的第一波中央系統功能**：AI-3 與依賴模組，須驗證永久免費、唯一贈送、任務計費防護、隱私、刪除、Queue／DLQ、PITR 等各自 Gate。後續中央功能按規格及依賴可再細分驗收里程碑，**此階段排序不代表產品功能刪除、正式環境或真使用者啟動**。

**跨各階段的安全基礎**：AI-4 的 OpenAPI、SDK、Worker、Expo 與 CI、Starry-only app/env 身分與獨立資料權威，AI-0 的完整整合驗收、P05 雙層事件及 D87 單一交易權威，都必須在**各階段適用的地方**具有真正證據；不可等所有階段結束才補必要 Auth/安全檢查。最終正式 Release Gate 不會因分階段改為自動分期上線。

以上 Phase 1/2/3 是本次**驗收順序**，不是 AI-0 自行創造了三次可獨立部署的 Release、三款 App，亦不表示決議已批准每項未定技術規格。各 Phase 的逐條驗收清單、里程碑名稱和正式 Scope 還須依最新來源和業主批准補正。

## 二、與 G00 SSOT／128 需求追溯的關係

原 [128 需求追溯文件](../requirements/AI0-R8-128-TRACE-REVIEW-20261027.md) 表示 128/128 原來源 heading 已編目（108 原主清單＋P01～P10 管理接入準備＋N01～N10 架構），DEV-A～I 九份交接包已有 212 處章節交叉索引，但**來源條款逐句/衝突語義尚未裁決**；`registry.v0.json` 是 `coverage=seed_only`，**並非完整批准**。

既有分類：54 項有業主批准方向但非正式 Gate 過關、39 項部分批准、8 項新決議取代舊行為、19 項 H-Global 工程暫停、4 項暫緩第一階段、3 項 AI 候選待核、1 項未獲明確批准。40 個原主章節衝突標記、39 處 DEV 舊檔衝突標記仍待逐項核對；此統計是歷史索引，不得當成驗收進度。

**「原定功能保留」的準確意義：**
- **不能擅自刪除**已核准且仍屬於 Starry 中央系統本波範圍的功能；只改優先驗收次序。
- **不能偷渡** H-Global 的教育中心／實體 PAYUNi／獎銜、第二波 Starry 獨立管理中心全 UI、暫緩條目或不同團隊正在開發的「繁星回聲」進本五 AI 工作。
- **不能把**索引 128 條／候選技術／舊被覆蓋規則解釋為現在全部業主已批准或應在 Phase1 實作；Starry ID 是中央共用後端，**不是**業主已授權獨立上架的 App。

正式 [`docs/release-readiness/release-readiness.v0.json`](../release-readiness/release-readiness.v0.json) 的 `G00-SSOT` 仍 **BLOCKED，evidence=[]**；本次只是 D00「驗收策略」子決策解決，**MVP 逐項核准／Source ID 逐條對照／保留、取代與暫緩處置仍未解決**。不能把 D00 的部分方向核准提升為 G00 正式通過。

## 三、已決／未決分離

| 議題 | 本次狀態 |
|---|---|
| D00 驗收排序 A（會員核心先驗，後續 Billing、免費 Battery、通知等） | **業主已核准方向** |
| 原已核准 Starry 中央系統功能是否因此刪減 | **不刪減** |
| 真正的 Phase 1 功能 Source ID／完整條款與 Acceptance Criteria | **仍待逐項核准** |
| G01 實際 Starry app_id、品牌／環境／Cloudflare 資源分離 | **待驗證、未授權真操作** |
| D87 單一交易權威 A | **先前已批准方向**；實體 DB layout 未批准 |
| D06 P05 事件+安全雙層 A | **先前已批准方向**；正式 schema／G06 13 欄未完成 |
| G00／G01／G02～G10 | **全部 BLOCKED**，不因驗收排序而解鎖 |
| 上線、main、Preview/Staging/Production、Store/RC/EAS、真 D1/Queues、Secrets、付費 | **全部未獲授權** |

## 四、AI-0 後續具體工作（非自動對其他 AI 派工）

1. 將 G00 逐項 Source ID 與最新人工範圍核對，細分**已核准 Starry 中央核心**、**其餘已核准中央模組**、**未批准/被替代/跨品牌暫停/第二波**；記錄各源條款與業主待定事項，不能只用原 128 heading 做部署清單。
2. 查明 G01 中央 ID 唯一身分／Starry test-only 環境與品牌隔離、API/Worker/Secret/D1 的權限責任，再提出具體可核准的測試配置；不得使用歷史 `echo-starry` D1 當成正式中央資料庫。
3. 對每一 Phase 保存 gate-by-gate Source ID、Owner、被拒絕測試、真實平台測試證據及批准者；沒有真證據就保持 blocked。
4. D87/D06 另有正式 ADR：`AI0-D87-STARRY-SINGLE-TRANSACTION-AUTHORITY-OWNER-DECISION-20261029.md` 與 `AI0-D06-P05-LAYERED-EVENT-SECURITY-OWNER-DECISION-20261029.md`，此文件不覆蓋其未核准技術細節。

## 五、硬性防線

**官方 Gate3 G00～G10 11/11 BLOCKED、evidence=[]、`P05/PUBLISHABLE=false`、`release_authorization.granted=false`、`deployment_automation.can_auto_deploy=false`。** 不合併 main，不修改正式 Gate JSON／現有 owner 原始碼或 Git Blob，不啟用 Cloudflare Preview，不部署測試／正式 Worker，不建立／修改真 D1/Queue/Secrets，不做官方 OIDC/Store/RC/EAS 真測、不付費，不操作 H-Global 或「繁星回聲」。

只在 AI-0 Draft 留下版本化決議、Gate 前置與追溯，並保留 GitHub 同 SHA CI 證據。此決議本身**不是**可向會員開放的分期版本。
