# AI-0｜R14 平行準備：第一波 ADMIN-PREP P01～P10 交付驗收與第二波安全接入（2026-10-27）

> 狀態：**DESIGN / CANDIDATE / NO WAVE-2 AUTHORIZATION**。此文件以目前 GitHub 的 [正式 Starry-only 管理中心預留契約](../contracts/FUTURE-STARRY-ADMIN-API.md) 及 [ADMIN-PREP Issue #13](https://github.com/starry-phd/id/issues/13) 為基礎。未擅自推定 P01～P10 已完成，也不將候選的第二波 12 領域／60 capabilities 當作已核准開發項目。
>
> 本次快照基準：[AI-0 已完成的 R13 同 SHA 整合 Draft #100](https://github.com/starry-phd/id/pull/100) HEAD `dc798cacea55cc376ed993876c0971035353d688`。四位 AI-1～4 正在各自 R14 專屬對話作真正模組開發；本 AI-0 只進行非 Owner 並行驗收規劃，不要求他們停工、修改既有 PR 基準或啟動任何正式環境。

## 一、P01～P10 接入門檻：已存在候選 ≠ 已完成

| ID | 第一波接入能力（依正式契約） | 目前能指認的離線檔案／候選 | 尚缺正式驗收的最少證據 |
| --- | --- | --- | --- |
| P01 | App 目錄、品牌/環境唯一性 | OpenAPI／API Surface 候選 | 真獲核的 Starry App Registry、跨環境唯一性否定測試 |
| P02 | OpenAPI 3.x、SDK、Scopes | API yaml、SDK、Surface checker | 正式核准且真實存在的端點、SDK 契約相容性與跨 App 權限 |
| P03 | 必需域內管理 API | Starry 會員管理候選和規格 | 每個業務 Owner 親自受權限保護的必要操作／審計，不可通用改 DB |
| P04 | Starry Admin principal、授權/Step-up | Admin 離線程式和負測 | 獨立 Starry 管理員身分、即時撤權、跨品牌/環境拒絕和高風險核准 |
| P05 | 版本化可追蹤事件 | P05 candidate、DTO | 正式批准 envelope/schema、真提交後 Outbox、重播與 Queue ACK/DLQ |
| P06 | 敏感操作稽核與查詢保護 | Audit recovery/Head 簽章離線碼 | 真持久稽核、權限/遮罩、法遵保留、獨立不可回退見證 |
| P07 | 健康、延遲、佇列/告警 | Health test + 概念規格 | 真監控資料、告警門檻、事故流程和來源 |
| P08 | 成本與使用量歸屬 | Expo/EAS cost policy 候選 | 真帳單/配額、App/服務成本單位與限額，不能預設零成本 |
| P09 | 發布與商店證據 | Release JSON + 安全 CI | 真 Cloudflare／EAS／商店部署驗收和 rollback，不能用 dry-run 冒充 |
| P10 | 設定版本與 Feature Flags | Staged policy/負測候選 | 真版本化設定後端授權、管理操作及審計與回滾 |

**此表只聲明目前可從 GitHub 指認的檔案和仍需的證據，不宣稱各功能已完整實作。** 詳細精確檔名、Owner、每項缺件以及全部 `candidate_unverified` 旗標在 [機器可讀矩陣](./r14-admin-prep-evidence.v0.json)。

## 二、非侵入式的自動驗收準備

此次新增：
1. [`r14-admin-prep-evidence.v0.json`](./r14-admin-prep-evidence.v0.json)：10 項 P ID、跨 AI Owner 映射、離線原始檔案路徑及尚缺真環境證據。每項 `wave1_accepted=false`、`actual_staging_evidence=null`、`owner_approval_url=null`。
2. [`verify-r14-admin-prep.mjs`](./verify-r14-admin-prep.mjs)：在固定 checkout 核對 10 項的**檔案確實存在**、契約仍含 P01～P10、未偽造核准/第二波開發許可、H-Global 隔離且正式 Release G00～G10 11/11 BLOCKED。這是一個**來源存在性及資料一致性檢查**，不是逐功能真實驗收。
3. [`r14-admin-prep-evidence.test.mjs`](../../packages/integration/test/r14-admin-prep-evidence.test.mjs)：在既有 GitHub AI-0 離線 CI glob 自動執行，包含偽造 Wave1/Wave2 完成、60 capabilities、域名、跨品牌、遺漏/重複 P ID、假檔案/路徑穿越、假 staging 和假核准、官方 Release Gate 解鎖等負測。**不新增 Runner／Workflow，也不動 Owner 程式**。

本機讀取範例：
```sh
node docs/operations/verify-r14-admin-prep.mjs
node --test packages/integration/test/r14-admin-prep-evidence.test.mjs
```

## 三、第一波與第二波的清楚邊界
- 第一波 Starry 必須預留的是 **P01～P10**：App/env、版本 API、實際必要的管理操作、管理員安全、P05 事件、稽核、健康/成本、發布證據與安全設定。尚未全數獲正式驗收。
- 第二波中央管理中心 V2.0 提出的 **12 大領域 × 5 capabilities** 只是候選，**不**先做 60 空管理 API、不做跨品牌總管或共用 admin token/資料庫、不部署 `admin.starry.phd`。若未來立項，需業主另行核准範圍/產品、獨立 React/TypeScript UI、管理角色與真環境安全 Gate。
- H-Global 與 Starry **完全獨立** Admin/Auth、正式 D1/R2/Secrets/Store/金流/部署/域名；H-Global 工程目前維持暫停。
- GitHub 最新 R13 #100 只有離線 CI 3/3 成功；真正 OIDC/Store/Worker/D1/EAS/PITR/管理中心上線及法遵證據仍未取得。

## 四、R14 四 Owner 完成後的 AI-0 用法

完成 R14 後，AI-0 先重查四位**最新** Source PR/HEAD/CI 和 PR 差異，再以隔離 Draft Git Tree 一次合併原始 Git Blob，繼承此安全前置檔案，跑**新 R14 整合 SHA** 同 checkout 全量驗收。只有實際來源與功能通過、人工核准、真環境證據完整，才能逐個更新 P ID 的接受狀態；不得以本機檔案存在證明部署或簽核。

**本文件本身不授權**合併 `main`、Cloudflare Preview/Staging/Production、真 DB/Secrets、商店/EAS、付費或任何 H-Global 工程。正式 G00～G10 仍 11/11 BLOCKED。
