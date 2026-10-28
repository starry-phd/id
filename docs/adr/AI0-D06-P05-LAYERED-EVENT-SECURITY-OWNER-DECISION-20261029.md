# AI-0 D06｜P05 分層事件核心＋獨立安全投遞封套：業主正式設計方向（2026-10-29 台灣）

> **決議狀態：`OWNER_DIRECTION_A_LAYERED_P05_APPROVED`**。
> 只核准**架構方向**，並非正式事件 schema 的逐欄定版、G06 驗收、實體 D1／Queue 設置或發布。當次業主對 AI-0 提供的 A/B/C 方案明確回覆「**A**」。
> 權威 GitHub 記錄：[AI-0 Issue #1 #6478960617](https://github.com/starry-phd/id/issues/1#issuecomment-6478960617)。

## 1. 本次正式方向

P05 採**兩層設計**，使所有模組可引用穩定的業務／稽核事件核心，而安全簽章、驗權及可靠佇列投遞由獨立安全 envelope 表示。兩層的信任邊界、版本、簽章對象與關聯映射由後續 AI-0 + AI-1～4 進行正式技術審查；此處只記錄選擇，不以 ADR 自動啟用任何程式。

### 第一層：Business / Audit Event Core

權威來源：[ADMIN-PREP #13](https://github.com/starry-phd/id/issues/13) 與 `docs/contracts/FUTURE-STARRY-ADMIN-API.md §2.3`。已存在**11 個核心欄位**：

`event_id`, `event_type`, `schema_version`, `brand_id`, `app_id`, `environment`, `occurred_at`, `correlation_id`, `resource_type`, `resource_id`, `result`。

**只有有付款／重試等需求的事件才另帶** `idempotency_key`（原 ADMIN-PREP 所述條件性欄位）。每類事件的合法範圍、required/optional、資料保留與遮罩規則，仍以未來正式版本審查結果為準；不能從以上列表推定所有產品事件都已核准。

### 第二層：Security / Delivery Envelope

為有安全投遞需求的事件另設**獨立、版本化**的安全結構，安全審查至少須明定：

- Issuer/KID、金鑰託管與旋轉、可信簽章或訊息完整性、時間／過期／nonce、防重播及簽章 payload 的序列化規則
- 事件與封套的 `event_id`／`correlation_id`／`idempotency_key` 對照、Auth/Session/issuer 即時權威驗證與隱私最小化
- **在 D87 單一交易權威方向之下**：由 AI-2 寫入 committed outbox，AI-3 受驗證 durable inbox，commit-before-ACK、重送、去重、DLQ/故障復原與稽核；角色責任分配需再正式確認
- 安全／稽核欄位是否必填、適用事件範圍、版本相容與向後遷移、法律資料刪除和 PITR 不復活的驗收

**R006 17-field `starry.p05.canonical.vnext.offline-candidate` 可作安全威脅模型參考，`AI0_R006_LIVE=false`，不因此升級為正式已核准的第 2 層 schema。**

## 2. 已知衝突不得靜默消除

上游 [#236 逐欄查核](https://github.com/starry-phd/id/pull/236)，並對照 `docs/operations/ai0-r008-p05-source-field-reconciliation.v1.json`：

| 來源 | 可確認 | 決議後狀態 |
|---|---|---|
| ADMIN-PREP P05 | 11 核心；條件性 `idempotency_key` 後最多 12 | **業務事件核心的既有設計基線**，尚待正式發布版本 |
| `release-readiness.v0.json` G06 | 要求「13 欄／其他事件適用範圍」，**未提供逐欄名稱** | **待來源權威審核**，不可猜第 13 欄 |
| R006 簽章候選 | 17 欄，僅離線 | **安全封套的候選參考**，不可擅改為 Live |

現有兩份可列舉欄位集合只重疊 `brand_id`、`app_id`、`environment`、`event_id`、`event_type`、`idempotency_key`；不得將 `version` 自動映射 `schema_version`，亦不得將 `issued_at` 自動映射 `occurred_at`。

業主選 A 不等於核准「13 欄」已不需要，也不代表 AI-0 可自行杜撰欄位、移除 release G06 的正式核對要求。後續必須取得該 13 欄權威來源，或者另由業主／安全審查**正式批准**修訂 G06 驗收準則；在此之前 `G06-P05` 保持 blocked。

## 3. 與 D87 的邊界

業主先前已核准 [D87「Starry 中央會員採單一交易權威方案 A」](https://github.com/starry-phd/id/issues/1#issuecomment-6478861308) 方向。**D87 的 A（交易一致性）與 D06 的 A（事件／安全分層）是兩件不同的核准**。

D06 不決定實體 D1 數量、品牌身分合併、跨 D1 原子寫入或資料保存期限；D87 亦不自動核准 P05 生產 schema。H-Global 及另一個「繁星回聲」App 不在本五組工作範圍；Starry Battery 永久免費、Ads 預設 OFF、Expo54 保持。

## 4. 待定事項與 Gate 硬限制

AI-0 後續須協調 AI-1～4 在各自受控工作流審查，**不是本 ADR 直接派工**：

1. **權威正式版本**：兩層 Schema ID、`schema_version`、`envelope_version`（僅候選命名）、內容簽章與跨版本兼容／切換；G06 未列舉的「13 欄」如何由官方來源解決。
2. **事務/投遞所有權**：D87 的唯一交易寫入者、AI-2 outbox、AI-3 inbox/dedup/ACK、AI-1 Auth/Session trust、AI-4 Worker/SDK contracts。
3. **保護與法遵**：Issuer 金鑰、重放及跨品牌/環境拒絕、Q104/Q119 刪除／合法保留、獨立 anti-PITR witness 與稽核遮罩。
4. **現實世界驗收**：Starry-only 隔離測試環境、資源別名/Access/費用上限、真 D1/Queue/DLQ、負向證據、回復/清理；需**另行明確業主批准**。

**現在仍為**：Gate1 PARTIAL/BLOCKED；Gate2 僅 R008/POST-R008 same-SHA **OFFLINE PASS**；Gate3 G00–G10 **11/11 BLOCKED、evidence=[]**；`P05/PUBLISHABLE=false`、`release_authorization.granted=false`、`can_auto_deploy=false`。

**禁止未授權行為**：合併 `main`、Preview/Staging/Production 部署、Cloudflare 正式設定/D1/Queue/Secrets、真 Store/RevenueCat/EAS／身份資料測試、付費、修改正式 Gate evidence、外部 App/H-Global 工作。

本次文件只在 [AI-0 Draft #242](https://github.com/starry-phd/id/pull/242) 追蹤架構核准與 GitHub-only 交接。關閉 Draft 並丟棄新增文件即可回退；原 AI-1～4 工作成果和正式環境不受影響。
