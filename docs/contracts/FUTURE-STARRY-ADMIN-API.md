# Starry｜第二波超級／中央管理中心接入預留契約（ADMIN-PREP，第一波必備）
> Contract status: **DESIGN / RESERVED — NOT DEPLOYED**；2026-10-26 首次補入 GitHub。Starry-only；H-Global PAUSED。
> GitHub acceptance tracker: [#13](https://github.com/starry-phd/id/issues/13)；AI-0 gate [#1](https://github.com/starry-phd/id/issues/1)。
> **必讀優先來源**：《第一波〈開發清單交接包〉》ADMIN-PREP（2026-10-25 已同意）、已人工核准的 DEV-A～DEV-I；《中央管理中心 V2.0 超完整規劃與 AI 交接包》僅是第二波長期候選（12 個責任領域／60 capabilities），不得視為已核准全部實作需求。

## 0. 要做、不要做

**第一波要做的是為第二波管理中心保留可安全接入的後端能力**：統一 App / 環境識別、OpenAPI 3.x、域內安全管理 API、Starry 獨立管理員身分／權限、事件稽核、健康／成本、可驗證發布證據、設定版本。已核准業務中必要的停權、退款、訂單修復或事故處置，不能全等第二波 UI 才有安全操作能力。

**第一波不做**：完整中央管理中心的 React／TypeScript Mobile-first Web/PWA 介面、60 個空白管理 API、跨品牌超級管理員／共用正式資料庫、所有報表、AI 自動總指揮、未核准額度錢包／獎銜制度、從舊案直接搬規格。第二波再另立獨立需求、人工審查與分期 PR。 `admin.starry.phd` 為規劃候選，**不是已核准或已部署的域名**。

### 品牌隔離與部署硬限制
- Starry Auth / 管理員 Session / 最高管理角色 / D1 / R2 / Worker / Secrets / 雲端帳號 / 付款／IAP / 部署僅屬 **Starry**；H-Global 全部暫停，不在此 Repo 建任何 H-Global 管理服務。
- 未來兩個獨立管理後台可使用共同的**非敏感** UI 套件、SDK、OpenAPI 形狀；使用各自後端、各自真正驗證的 scopes 與資料庫。不得用一個萬能 admin gateway 直接寫兩品牌 D1。
- 若未來需跨品牌總覽，只能待雙方專案與授權正式核准後，另案設計**最小、只讀的彙總**。此工作與 `docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md` 的本人同意會員基本資料同步是**不同的權限和接口**，不能混同。
- 不預設 Starry 的管理員角色等於 H-Global「超級管理員／寰宇秘書」特定職務名稱；Starry 角色清單和高風險核准政策須由 Starry 管理規格獨立核准。

## 1. 第一波共同基礎 P01～P10（沿用主交接包編號）

| ID | 必要接入能力 | 現階段責任（五 AI 映射，並非另建五系） | 可驗收的交付物 |
|---|---|---|---|
| **P01** | App 統一識別與目錄：`app_id`、`brand_id`、`environment`、platform/bundle/package/web identity、owner、用途、status | AI-4 架構/登記、AI-0 Gate | Starry App Registry 契約、環境識別及唯一性／隔離測試 |
| **P02** | OpenAPI 3.x + API 版號、Scopes、錯誤碼、分頁、相容性與 SDK | AI-4，AI-1～3 提供域內 API | 已核准而**真實存在**的 API 契約、型別／SDK、契約測試；草稿不得標示 deployed |
| **P03** | 受保護管理專用 API，僅限當期已核准且必要的域內操作 | AI-1 Auth/會員；AI-2 Billing；AI-3 免費 Battery/通知/隱私；AI-4 管理約定 | 各 owner 實作或明確預留之管理能力表；Backend 驗權、無 DB 超級直通端點 |
| **P04** | Starry Admin 身分／權限與高風險強化驗證 | AI-1；AI-3 記錄稽核；AI-0 審核 | admin principal + role/action/resource scopes；read/write/approve/refund/deploy/export/restore 分離、越權拒絕測試 |
| **P05** | 統一可追蹤事件 | AI-3 事件規範；AI-4 共用 DTO；各 owner 產生事件 | 版本化 envelope、correlation/idempotency 與去重／必要補償測試 |
| **P06** | 安全稽核 | AI-3；各領域補足敏感操作紀錄 | 必要 actor、action、resource、result、permission、time、version、approval evidence、遮罩及查詢授權 |
| **P07** | 健康、延遲、錯誤、佇列、告警、資料新鮮度 | AI-4／AI-3；AI-2 提供付款訊號 | 可核實/受授權監控資料來源、失敗警報與復原流程 |
| **P08** | 按品牌/App/服務/作業/期間的成本與使用量歸屬 | AI-4 計量、AI-2 交易來源 | estimated vs provider bill vs actual payment 分開、單位/幣別/期間、可對帳 |
| **P09** | 開發、部署、商店發布證據 | AI-4／AI-0 | req/decision version、Repo/PR/SHA、CI、EAS、Cloudflare env deploy、rollback、App Store/Play 狀態的來源 |
| **P10** | 設定版本與 Feature Flags | AI-4 契約、各域 owner 管自己的設定，AI-1/3 授權/稽核 | `config_version`、brand/app/environment/scope、actor/reason、enabled state、rollback；敏感變更由後端授權 |

> 映射說明：原交接包中的 DEV-D、G、H、I 是 Admin 接入準備重點；目前 GitHub 只開發 Starry，將它們對應至 AI-1（D + E）、AI-4（G + I）、AI-3（H + A），AI-2（B）。這**只是工作指派**，不可取代 DEV-A～I 原業務規則，也不能將 H-Global 的 C、F 工作帶入 Starry。

## 2. 接口設計契約（候選 DTO／安全邊界；不是已實作的 API Path）

### 2.1 App / Env 與版本上下文
- 所有敏感管理入口需有不可混淆的 Starry 品牌與 App/環境上下文；`brand_id` 不是可由請求者任意指定後就能獲權限的參數。
- 建議 API 合約概念 `AdminRequestContext`：`principal_id`（經驗證）、`brand_id`、`app_id`、`environment`、`resource`、`action`、`correlation_id`、`request_id`。此為**資料形狀提案**，真實 Auth claim、路徑、scopes 待 AI-0/AI-1/AI-4 Gate 1 核准。
- public／member／internal service／admin routes 必須分界；管理員身份/權限由**後端**每次查驗，不能只在 React/Expo 按鈕隱藏。Staging principal 無權直接操作 Production。

### 2.2 授權與高風險流程
1. Authenticate an independent **Starry** admin session; validate issuer/audience/session revocation and organization/resource boundary.
2. Authorize `action + resource + app + environment` explicitly; default deny. `read` 不可自動升格 `export`、`write`、`refund` 等。
3. 對停權、退款、改變權限、敏感修復、部署等操作按獨立核准政策實施 MFA/step-up、影響預覽、必要審核和 request replay/idempotency 防護；核准人數與誰可以審核仍待 Starry 確認。
4. 執行者只呼叫領域 owner 的合法管理 API；領域服務自行決定交易與寫入。**不可做「傳任意 SQL / 寫任意 D1 資料列」通用入口**。
5. 產生遮罩後的成功／拒絕／復原稽核紀錄；操作、事件與部署可藉 `correlation_id` 追蹤。

### 2.3 已同意事件/稽核 envelope
事件核心欄位（保持與 ADMIN-PREP P05 一致）：`event_id`、`event_type`、`schema_version`、`brand_id`、`app_id`、`environment`、`occurred_at`、`correlation_id`、`resource_type`／`resource_id`、`result`；需重試／付款者帶 `idempotency_key`。稽核額外按需保留 actor、permission、action、approval evidence、version；**禁止** secrets、tokens、支付卡片號碼、無必要個資原文。

### 2.4 安全設定、告警與資源計量
- 設定／旗標以版本、變更人、範圍、環境、原因、回滾可追查；業務 domain owner 最終決定哪些配置存在，不能透過一個總控配置繞過本領域安全規則。
- 指標應能以正確採集資料區分 P95、錯誤、Queue backlogs、重要支付失敗、資料新鮮度；不能用註冊會員總數偽造「同時上線」。
- 計量資料分清 estimated、provider-actual bill、payment transaction；沒有資料應呈現 `unknown / unavailable`，不杜撰用量、費用、業績與部署成功。
- 部署／商店狀態僅從實際 GitHub PR/SHA/CI、Cloudflare／EAS、商店審核證據判定；Preview 與 policy-only CI 不能算 Production release。

## 3. 第一波各職責 Gate（需明確留在 GitHub Issue/PR）
- **AI-0 #1**：將本契約納入 Gate 1／Gate 2，追蹤 [#13](https://github.com/starry-phd/id/issues/13) P01～P10 與來源優先順序；衝突時依主交接包及人工核准決議，不自行解鎖 60 個 UI。
- **AI-1 #2**：Starry Admin 独立 Session／RBAC + ABAC principal/scopes、step-up/撤權與員工/會員查詢最小權限；提供拒絕跨品牌、跨環境、越權、撤銷後舊 token 測試。
- **AI-2 #3**：Starry-only 商品/SKU/訂閱/收據/權益/退款/對帳（僅已核准的管理能力；先沙盒）；本人／Admin scope 與重放／冪等／退款稽核。免費 Battery 不得被 Billing 當成付費。
- **AI-3 #4**：Starry 免費 Battery、通知、申訴、隱私／稽核／復原的管理最小操作；P05/P06 事件、安全留存與查詢驗權、Queue 失敗／重試證據。
- **AI-4 #5**：Starry AppRegistry、OpenAPI/SDK、AdminRequestContext 草案、共用事件/設定 DTO、P07–09 監控/成本/發布證據、必要 contract tests；不部署 Admin UI／H-Global，無 live secrets。

### 最低驗收（不能用文件勾選取代實際測試）
- [ ] 應用/域/環境識別完整、唯一；以測試/正式環境交叉操作應拒絕。
- [ ] Starry 管理員授權與撤權：未授權/越權/不同品牌/跨環境的請求被後端拒絕；UI 隱藏不是驗證。
- [ ] 主要當期敏感操作至少有安全人工操作方法、受保護的領域 API 和稽核；不能直接寫正式 D1。
- [ ] API 契約中草稿 vs 已測試 vs 已部署狀態明確，不以 60 個空端點假裝完工。
- [ ] 事件具版本／關聯與必要去重；安全日誌遮罩私密值，留存與權限可測。
- [ ] 監控/成本/部署來源可追溯，缺失時標示未知。
- [ ] 每組 PR 附合約版本、commit SHA、CI 真實 typecheck/lint/test 結果與影響分析。
- [ ] 第二波未經正式啟動；H-Global Repo／D1／Cloudflare 未觸及；跨品牌會員 API 仍關閉。

## 4. 第二波超級管理中心 V2.0 如何接入

長期候選藍圖涵蓋生態/App、會員/登入、管理員/安全、API/AI 開發者、金流/訂閱、Starry AI/免費 Battery、媒體內容、活動票券、通知客服、監控成本、DevOps/App Store、數據/AI 總管等 **12 大領域 × 每領域 5 capabilities**。這些不是現在要建立的 60 個 API 或選單。

未來正式立案後，**Starry 獨立**的 React + TypeScript Mobile-first Web/PWA 透過可版本化的 **Starry-only、受保護管理 API** 讀寫授權資料；後端領域服務仍擁有資料的唯一寫入權。若日後 H-Global 恢復開發，須另外開立自身後台/契約/帳號/密鑰/部署，不接受 Starry 管理 token。

## 5. 文件基準／先後與禁止推定
- **第一優先**：正式第一波主清單 ADMIN-PREP P01～P10（2026-10-25 已同意）及逐項人工核准結果。
- **第二優先**：DEV-A～I 已核准業務模組的「此專責模組要預留的界面」；其中 DEV-D/G/H/I 的安全架構不可被忽略。
- **候選願景**：《中央管理中心 V2.0 超完整規劃與 AI 交接包》（第二波長期參考，非自動解鎖全部 60 項）。
- 其他 future cross-brand member sync 設計在 `FUTURE-HGLOBAL-MEMBER-API.md`，預設 DISABLED；不構成 Admin API 需求或核准。
- 本文件只作**架構/驗收預留**。任何 path、scope、management domain、資料表、DNS、Worker、Cloudflare 正式部署都未經本文件自動建立。
