# AI-2 W1｜Receipt 唯一鍵 × Scope 隔離修正說明（Design-only）

**來源：**[AI-0 Issue #3 修正工作令 #6489094776](https://github.com/starry-phd/id/issues/3#issuecomment-6489094776)；AI-0 [整合 Draft #250](https://github.com/starry-phd/id/pull/250)，固定基準 `7316ee0f014a01649eea87a62b3ad6cdb6b1febd`。本說明和同目錄 [機讀 amendment](./AI2-W1-D87-RECEIPT-IDENTITY-SCOPE-AMENDMENT.v1.json) 是**追加審查層**，不修改 [AI-2 #249](https://github.com/starry-phd/id/pull/249) 的兩份原始檔或 #250 已整合的 Git blobs。D87=A 設計方向仍已核准，實體 DB／正式 Store／SKU 未核准。

## 修正結論

AI-0 指出的差異確實存在：原 JSON `identity_keys.transaction_unique_key` 列有 `brand_id,app_id,environment,provider,store_namespace,store_transaction_ref`；原 `billing_verified_receipt.unique[0]` 與 ADR 則列 `provider,store_namespace,store_transaction_ref`。兩者**不能同時當成兩套互不相同的 SQL UNIQUE 實作指示**。

**本 amendment 明確裁定：**

| 名稱 | 唯一性／作用 |
| --- | --- |
| **權威 receipt 實體唯一鍵（候選）** | **`(provider,store_namespace,store_transaction_ref)`**；和 #249 `billing_verified_receipt.unique[0]`、ADR 一致 |
| 原六欄 `transaction_unique_key` | **擴充的 scope-guarded 邏輯查詢/來源對照投影**，不是另一個可替代 receipt 主唯一鍵、也不是可從 client 改 scope 來插新 receipt 的許可 |
| `brand_id,app_id,environment` | 必須各自與可信 App Registry、store_namespace 及已存 receipt 的**不可變 scope**比對；拒絕才是正確結果，絕非省略授權檢查 |
| **first-claim** | **`(provider,store_namespace,original_transaction_ref)`**；**絕不加入 `s_user_id`、member_id、member_digest、session_id**，避免同筆購買跨會員領兩次 |
| **provider lifecycle event** | **`(provider,store_namespace,provider_event_ref)`**，與 Store transaction identity **不同**；一筆 Store receipt 可先發生 purchase、後發生 refund 等不同事件，同 event ref 再送才是重播 |

**store_namespace 必須是由可信後端從官方 Store 證據與已核准的不可變 App Registry 綁定推導出的版本化、無歧義、不可由使用者任意選擇的命名空間**，其隔離關聯至少涵蓋：

1. `brand_id`（Starry 唯一可信品牌）；
2. `app_id`（與官方 Store application 身分經可信登記綁定）；
3. `environment`（Starry 執行環境）；
4. `provider_store_application_identity`（經官方驗的 bundle/package/application 綁定，實值未決）；
5. `store_verification_environment`（官方 Sandbox/Production，**與 App 執行環境分別核對**）；
6. `provider_authority_or_account_namespace`（能證實的 provider issuer/tenant/Store account 權威領域；無法確證唯一性時直接拒絕，**不猜任何帳號**）。

上述六項**不是已核准的正式 Store 欄位或 SQL 結構**；其版號、編碼、來源憑證、法律保存與導入方法都要 AI-0/AI-4 和安全審查。不同 namespace 下外觀相同的 transaction ref **不能單憑更改 app/env 來視為新購買**：必須各自有獨立的官方 Store 應用與 issuer scope 證據；否則拒絕。核准前不執行。

**RevenueCat 分離：** RC webhook、App User ID 與 RC event version 只能提供另一路待驗證訊號，不能僅因 RC 回報而建立 Apple/Google 權威 receipt，亦不得與 Store `source_version` 跨域比較排序。Store receipt、original purchase lineage、provider event 各有獨立去重用途。

## 審核界線與回退

本次只有**一個新增 amendment JSON＋本短說明**，不變動任何 runtime/TS/SQL/schema migration/共用 OpenAPI／Worker/CI；用 GitHub 直接讀原 #250 兩份檔、回讀新 JSON，核對唯一鍵/namespace/原 Blob SHA，必要的 GitHub Actions 須用**本 Draft 的 exact SHA**單獨記錄，不拿 #250 舊 CI 冒充本 SHA 成功。

實體 D1、官方 Store/RevenueCat、App/SKU/帳號、Auth 原子 fence、D06 安全封套與第13欄、Q104/Q119、anti-PITR、費用與正式 Gate 全仍待核准。**G00–G10 11/11 BLOCKED、G04/G05/G06/G07 evidence=[]、P05/PUBLISHABLE=false、release_authorization.granted=false。** 無 main merge、部署／Preview、真 D1／Queue／Store／Secrets／費用；H-Global／繁星回聲不介入。

**回退：** 關閉這次新 Draft 並只棄置上述兩份 amendment 檔；#249、#250、其原始 Git blobs、其他 Owner 及 main 都不變。
