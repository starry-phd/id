# Future H-Global ↔ Starry Member Basic Profile API — RESERVED, DISABLED
> Repository: `starry-phd/id` · Draft contract only · Owner: AI-1 (identity/privacy) + AI-4 (OpenAPI/SDK), Gate: AI-0.
> 2026-10-26 decision: **Starry 開發進行中；H-Global 全面暫停。預留介面，不代表 H-Global 已有服務。**

## 1. 已決議與不可突破的邊界
- 各品牌有**獨立 Auth、Session、不可變的內部 `s_user_id`／`h_user_id`（暫用欄位名）、D1、會員資料、Token、Secrets、部署與管理權限**。
- 不能用相同 Email／姓名／手機號碼直接假定同一個人，也不能由 Starry 自行建立或修改 H-Global 資料庫。
- 未來如要建立雙品牌帳號連結，**雙邊身分驗證 + 本人明確同意** 缺一不可，且必須可解除連結和撤銷同步授權。
- 只可同步本人核准的**指定會員基本欄位**；具體欄位白名單與來源權威、寫入方向、衝突政策、保存期限**尚未核准**。本預留文件不替業主作決定。
- 絕不跨品牌共享或同步支付訂單、訂閱、購買權益、管理職務、獎銜、中心權限或任何 DB/Secret。
- 目前禁止建立 H-Global API、Auth、資料庫、Workers 或任何 Production 整合。

## 2. Starry 端預留抽象層（尚未實作）
預定 interface / adapter 名稱僅供後續討論：
- `CrossBrandMemberLinkPort`：檢視／建立／撤銷連結的 Starry 端抽象層；只有未來雙方均具備認證與授權時才可啟用。
- `BasicProfileSyncPort`：針對 approved field allowlist 同步基本資料；不允許任意 JSON 欄位／全量物件同步。
- `DisabledCrossBrandAdapter`：在未啟用或找不到 H-Global 正式服務時明確回報 `FEATURE_DISABLED`，不外呼、不存取另一品牌、不偷用共享 D1。
- `ConsentRecord`（預留概念）：同意版本、同意的欄位範圍、建立／撤銷時間與必要稽核事件；欄位定義待 AI-0 Gate 1。

> 上述只是一組**候選程式介面名稱**，不是已發佈 SDK、正式服務網址、已建立資料表或可用 API。

## 3. 預留狀態與設定
```yaml
cross_brand_member_link:
  status: reserved_only
  enabled_by_default: false
  feature_flag_name_candidate: CROSS_BRAND_MEMBER_SYNC_ENABLED
  allow_live_network_calls: false
  allow_hglobal_database_access: false
  allow_real_member_sync: false
  approved_field_allowlist: []  # 待決議，不是「所有欄位」
  hglobal_api_base_url: null     # 不可擅自填寫舊服務/猜測 URL
  consent_required: true
  verify_both_identities: true
  revocable: true
```

## 4. 未來啟用 Gate（目前一律不滿足）
1. 業主另行正式解除 H-Global 暫停並確認 H-Global 獨立開發計畫；
2. 兩品牌各自 Auth、會員庫、API 皆可驗證；
3. 指定欄位白名單、欄位來源權威、雙向或單向、版本與衝突策略、保存／刪除處理正式核准；
4. 完整兩邊身份驗證、明確個人同意、撤銷與最小權限 scoped token；
5. OpenAPI 3.x、Sandbox mock、拒絕不在白名單的欄位、撤銷後禁止再同步、失敗重試冪等與稽核測試；
6. AI-0 Gate 驗收、資安／隱私審核、業主批准後，才可在隔離環境進行真實跨品牌呼叫。
**任何單一 Gate 未達成，均維持 DISABLED。**

## 5. GitHub-only 任務交接
- AI-1：在 [Issue #2](https://github.com/starry-phd/id/issues/2) 提出身份／同意／資料邊界與解除連結草稿。
- AI-4：在 [Issue #5](https://github.com/starry-phd/id/issues/5) 提出非啟用 OpenAPI 3.x 契約草稿、disabled adapter/mocks 的測試規格。
- AI-0：在 [Issue #1](https://github.com/starry-phd/id/issues/1) 協調版本、決議欄位白名單尚未定案的待辦；裁決後發布本文件的版本化更新。
- 所有交接依 `docs/ai/HANDOFF-PROTOCOL.md`，只在 GitHub Issues／PR 留痕，不要求業主轉貼消息。

## 6. 與需求來源的關係
經核准的新專案方向是雙 Auth、雙會員 ID、本人同意後有限欄位跨系同步；交接包亦指出**允許同步的精確欄位清單與衝突政策尚待確認**。因此目前只預留、不能自行套入舊案中央共用 Auth 或舊系單庫同步。
