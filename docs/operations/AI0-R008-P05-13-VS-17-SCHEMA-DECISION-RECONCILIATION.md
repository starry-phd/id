# AI-0 R008｜P05 事件契約跨來源逐欄對照（待業主裁決，非新規格）

**狀態：DECISION REQUIRED／READ ONLY／NOT APPROVED。** 本文只對照既有 GitHub 權威資料，沒有修改 P05 正式規格、事件產生器、Worker、D1、Queue、金流、發布授權或驗收旗標。

## 一、三份來源實際寫了什麼

| 來源 | 原文可核對的規格 | 必須保留的限制 |
|---|---|---|
| [ADMIN-PREP #13](https://github.com/starry-phd/id/issues/13) 及 `docs/contracts/FUTURE-STARRY-ADMIN-API.md §2.3` | 統一事件 **11 個核心欄位**；付款或重試事件追加 `idempotency_key`，**條件成立時合計 12 個** | 核心中的 `resource_type`、`resource_id` 是兩個不同欄位；`idempotency_key` 不是所有事件必填。此處屬 P05 可追蹤事件管理契約 |
| `docs/release-readiness/release-readiness.v0.json` G06-P05 | 要求業主核准「**13 欄／其他事件適用範圍**」、權威來源及跨 AI-2→AI-3 版本兼容／負面測試 | 該 G06 條目**沒有列出這 13 欄的逐欄名稱**，不可補造第 13 欄；目前 G06 blocked、evidence 空白 |
| `packages/integration/src/ai0-r006-p05-canonical-proposal.ts` | `AI0_R006_FIELDS` **17 個欄位**、`starry.p05.canonical.vnext.offline-candidate` | `AI0_R006_LIVE=false`；這是簽章/權限審閱用的離線候選，絕非已核准通用正式 P05 |

### ADMIN-PREP：11 個核心欄位

`event_id`, `event_type`, `schema_version`, `brand_id`, `app_id`, `environment`, `occurred_at`, `correlation_id`, `resource_type`, `resource_id`, `result`

**付款／重試才追加：** `idempotency_key`。Issue #13 將 resource_type/id 簡寫，正式 contract §2.3 清楚分成 `resource_type`／`resource_id`。欄位數為 11＋條件 1，不可自行稱為正式 13 欄。

### R006 簽章候選：17 個欄位

`version`, `purpose`, `brand_id`, `app_id`, `environment`, `event_id`, `event_type`, `actor_ref`, `auth_version`, `session_version`, `idempotency_key`, `issuer_kid`, `issuer_epoch`, `issued_at`, `expires_at`, `nonce`, `payload_sha256`

## 二、不是 13 對 17「只多四欄」

- **兩份可列舉 schema 完全同名交集：6 欄**：`brand_id`, `app_id`, `environment`, `event_id`, `event_type`, `idempotency_key`。
- **ADMIN-PREP 12 欄列表獨有：6 欄**：`schema_version`, `occurred_at`, `correlation_id`, `resource_type`, `resource_id`, `result`。
- **R006 17 欄候選獨有：11 欄**：`version`, `purpose`, `actor_ref`, `auth_version`, `session_version`, `issuer_kid`, `issuer_epoch`, `issued_at`, `expires_at`, `nonce`, `payload_sha256`。
- `version` 不可靜默等同 `schema_version`；`issued_at` 也不可等同 `occurred_at`。而 `correlation_id`、resource 指涉、`result` 等管理事件欄位在目前的簽章候選中未列出；兩份契約可能是**不同層次用途**，尚未由業主核准要合一或分層。

## 三、建議送業主／AI-0 決策，而非由 AI 任意發布

| 選項 | 可討論的設計 | 目前 |
|---|---|---|
| **A** | 明確分成共用 P05 事件核心、及獨立的簽章/投遞安全 envelope，另訂兩者的版本、映射、用途與一致性 | 候選；需要 AI-1/2/3/4 合約審閱與業主批准 |
| **B** | 整合成**單一**正式版本化 Schema，但須先完整確定 13 欄來源／各事件適用性、版本遷移與相容規則 | 候選；不得從 17 欄模擬版直接發布 |
| **C** | 維持現有兩種離線契約、全部 Live Gate blocked，待安全／法務及架構決策後再定 | **目前保持的保守狀態**，不是正式宣告選定 C 架構 |

**正式決策必填**：唯一權威 schema 名稱與版本；`event_id`、`correlation_id`、`idempotency_key` 關係；事件 payload 對應；`actor_ref`／Session/Issuer 來源；Schema 版本相容；AI-2 outbox 與 AI-3 inbox/稽核的唯一 ownership；信任邊界與測試範圍；業主批准紀錄 URL；第 13 欄的官方定義（若 13 仍為要求）。

## 四、硬性封鎖與後續

- [AI-0 R008 四 Owner integrated Draft #234](https://github.com/starry-phd/id/pull/234) `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9`：12/12 原件，1,776 Node + 413 SQLite `:memory:` 同 SHA OFFLINE PASS。**這不是 G06 正式 P05 完成**。
- [AI-0 R008 read-only evidence-gap #235](https://github.com/starry-phd/id/pull/235)：Starry 資源盤點與 G00–G10 11/11 blocked；此審閱不需任何 Cloudflare 改動。
- G00 首款 App/MVP、G06 P05 契約、#87 A/B 跨 D1、Q104/Q119 隱私法務仍需專屬業主決議。所有 Gate1 PARTIAL/BLOCKED、Gate3 11/11 BLOCKED、`P05/PUBLISHABLE=false`、`release_authorization.granted=false`，不可擅改。
- 無 main merge、Preview/Staging/Production、Cloudflare flag PATCH、正式 D1/Queue/Store/RC/EAS、Secrets/Ads、費用與 H-Global。Starry Battery 永久免費、Expo54 不變。

**回退：**關閉本 AI-0 獨立 Draft／移除本對照文件即可；#234、#235、Owner 原始 PR、既有發布 Gate 與 Cloudflare 設定都不受影響。
