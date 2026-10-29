# AI-2｜W2 P0 Main Promotion：Billing／Store／RC 模組、Startup、CI 與完整 Tree SHA 安全審查

> **結論：SOURCE-ONLY CONDITIONAL MAIN CANDIDATE；LIVE BILLING / OFFICIAL STORE / MIGRATION / DEPLOYMENT NOT APPROVED。**
>
> 依 [AI-0 對 AI-2 工作令 Issue #3 #6489313616](https://github.com/starry-phd/id/issues/3#issuecomment-6489313616)，審查 [AI-0 W2 #255](https://github.com/starry-phd/id/pull/255) **exact `6ae5c2bc5cbf71db715e7e70b18833c4cd6f8a79`** 相對當時 `main` **`8be31efb3dfba66755f297b315593e33cdacfe39`**。最新業主允許 AI-0 合併／部署的 [Issue #1 #6489238005](https://github.com/starry-phd/id/issues/1#issuecomment-6489238005) **不授權本 AI-2 Owner自行操作，也不等於 Live Gate／真資源／金流或 SKU 已核准。**
>
> 本次範圍只限 Starry **中央 ID**。不涉及 H-Global、繁星回聲、任何真 Store/RC/D1/Queue/Secrets/EAS/費用；不重做 W2、R008、POST-R008、原 G04/G05 13 項批准矩陣或模擬輪次。

## 1｜檔案與 Git Blob SHA：已逐一由 #255 HEAD 讀回

| 檔案 | Git Blob SHA | Reviewer 結論 |
| --- | --- | --- |
| `apps/api/src/index.ts` | `a9addff8a16c351ee8cbf3900c8aee52e7fb012b` | **公開 Worker 唯一 runtime 入口**：development/staging trusted env、Starry app id 後只處理 GET `/v1/health`。沒有 Billing route 或 Billing import。 |
| `apps/api/wrangler.toml` | `55f53e1e63349b2ab275d92479d10258af47b6b4` | `main=src/index.ts`、`workers_dev=false`、無 D1／Queues binding／正式 production env；`api:check` 僅 dry-run。這是 repo config，不是當下 Cloudflare 真設定證明。 |
| `package.json` | `423a539dfb6cac56c6290bf27bf3d6688d40c11a` | npm workspaces 只有 `apps/*` 與 `packages/sdk`，**沒有 `packages/rebuild-billing` runtime workspace**。無 install/postinstall Billing 購買腳本；`api:check` 是 `wrangler deploy --dry-run`。 |
| `apps/api/package.json` | `54f7b12d3151a8acbc616672904299fd8e5a1735` | 僅 Worker dev／Node test scripts；無 Billing 購買啟動腳本。 |
| `apps/mobile/package.json` | `64f0f38f215dc68b9d49ce520a38bc552764f5a2` | `expo-router/entry`；已列 dependencies 中**沒有 react-native-purchases／RevenueCat IAP SDK**。不等於完整 mobile 所有路由已逐檔安全驗證。 |
| `apps/mobile/app/_layout.tsx` | `607453975b1aa45bd5e56d1ffca56f920e17b9c9` | 只有 `expo-router` Stack；未 import Billing。 |
| `packages/sdk/src/index.ts` | `b73c40bb72c7c2605e9caf77df4ffe6f0d71eee9` | Public SDK 為 liveness-only；可能透過顯式調用 fetch 健康檢查，**不是** Store／RC 金流；無 Billing writer import。 |
| `apps/api/test-support/ai4-w2-local-worker-composition.ts` | `0ac95f75cfac6d5fe71fc46606ac96aad5f1fb61` | W2 **test-support local dispatcher only**，`profile_registered_in_public_worker=false`；沒有公開 Worker runtime registration 或 Billing import。 |
| `packages/rebuild-billing/src/index.ts` | `d01f1fcf8c639f6b768fee86b8885d0d11b25554` | **BILL-001 Sandbox planner**，export `planSandboxPurchase`，以注入的 `StorePort.verifySandboxEvidence` 產生 offline sealed Plan；無 official provider implementation。被顯式調用才執行。 |
| `packages/rebuild-billing/src/billing-d1.ts` | `95280644a197952828a12e48ebb13e09818fb548` | 可呼叫 `createSandboxBillingD1Writer(...).commit(...)`，使用注入 D1-shaped `db.batch`（五 statement），非 import/startup 自動寫入；但**禁止綁定真 D1 或解讀為正式 Transaction Authority**。 |
| `packages/rebuild-billing/schema/0001_billing_rebuild.DRAFT.sql` | `aa3810fa727b312b97f02febc89f3f2ae6f4161f` | SQL 草稿：`billing_owner`／event／entitlement／outbox；**沒有 migration runner 自動執行**。不要直接 apply。 |
| `packages/rebuild-billing/schema/0004_billing_atomic_DRAFT.sql` | `5acdcffab9cc8195cfa8a28045612ee0174eddff` | 原子 receipt guard／索引的候選；正式 D1 schema/migration／rollback 尚未核准。 |
| `packages/rebuild-billing/src/wave1-billing-revenuecat-review.ts` | `7a145e558f7a5ac004b2b87689b2696cc964ef45` | R001 RC fixture review，`WAVE1_BILLING_LIVE=false`，沒有真 SDK。 |
| `packages/rebuild-billing/src/wave1-r002-signed-auth-billing-bridge.ts` | `eab58fc534bbbec5455cfb67689f58383df1ca3f` | R002 只把 AI-1 signed Auth／本機 candidate 連到 review；`WAVE1_R002_BILLING_LIVE=false`。 |
| `packages/rebuild-billing/src/wave1-r003-canonical-identity-store-review.ts` | `bafd7848605077b18e924aa23dfa16496cff9228` | R003 identity/Store review，`AI2_R003_LIVE=false`。 |
| `packages/rebuild-billing/src/wave1-r004-entitlement-continuity-review.ts` | `46e6e1389bc1006f39ac4c092e6c10b683c81551` | R004 deny-only／`R004_BILLING_LIVE=false`。 |
| `packages/rebuild-billing/src/wave1-r005-cross-os-signed-auth-review.ts` | `7b8ee1b2bbf1539696b2e01dc367bfe88f489c52` | R005 review-only／`R005_CROSS_OS_LIVE=false`。 |
| `packages/rebuild-billing/src/wave1-r006-synthetic-store-provenance.ts` | `d64a655ce4713035a8e590f6e93c65f30f7c7eae` | R006 WebCrypto **synthetic HMAC**，不是 Apple JWS／Google API／RC；`R006_STORE_LIVE=false`。 |
| `packages/rebuild-billing/src/wave1-r007-official-provider-adapter-deny.ts` | `522da05c8fa34e4f8f3f786d683974db9e984087` | R007 `review_only`／`R007_OFFICIAL_ADAPTER_LIVE=false`；官方聲稱一律不可提升成 verified。 |
| `packages/rebuild-billing/src/wave1-r008-cross-provider-conflict-deny.ts` | `85cbb2f6fca4c93d08dca05830e4a5ed78b95ef3` | R008 Store×RC 不可信配對拒發權／`R008_RECONCILIATION_LIVE=false`。 |
| `packages/rebuild-billing/docs/AI2-W1-D87-RECEIPT-IDENTITY-SCOPE-AMENDMENT.v1.json` | `baef3290f6212856358afd005ab6ad0c5d27c881` | #251 **已在 #255** 且未改 blob：修正 authoritative receipt unique 的設計說明，**尚未落成正式 writer SQL**。 |
| `packages/rebuild-billing/docs/AI2-W1-D87-A-BILLING-AUTHORITY-INTERFACES.v0.json` | `ced186d571a49c23f68f6b9e41822034b17a36db` | 歷史不可變六欄 `transaction_unique_key` 只作 scope-provenance lookup，需連同 #251 amendment 閱讀，不能將歷史欄位直接生成 SQL。 |
| `.github/workflows/rebuild-billing.yml` | `672173c85c58ccff242c849cc1591254a65970af` | PR／手動觸發；strict TS、Node tests、Python SQLite memory；沒有 Store／RC 呼叫或遠端 DB migration。 |
| `.github/workflows/ai0-current-offline-gate.yml` | `ba43a9b1424e621b74d0d7a05e555d61d3be1802` | PR／手動觸發；`npm ci`、TS/lint/SQLite memory、Expo DEV、Worker **dry-run** 和 release blocked 斷言，不部署。 |
| `docs/release-readiness/release-readiness.v0.json` | `0ea2e40692fb2e9f7e0c282ac1ece91ad2c740ba` | 官方 G00–G10 11/11 BLOCKED，G04/G05 evidence=[]，`release_authorization.granted=false`。 |

額外已讀 W2 主批次 `.github/workflows/ai0-*`、`ai4-rebuild-*`、`rebuild-ai3.yml` 等**21 個由已可見 compare 路徑辨識的 Workflow**：在逐檔來源已讀到的 run steps 中未見實際 Store/RC purchase/receipt verify，或遠端 `wrangler d1 migrations apply`／正式部署。**不能把「抽查 21 個 Workflow」擴張成「已審完全 846 檔」**；故以下完整 recursive Tree 稽核是 main source promotion 的獨立必要條件。

## 2｜須隔離／修正的實際 code 差異（不能只說「CI 全綠」）

**A. Store／RC truth ≠ 注入 callback 產生的 sandbox snapshot。** `src/index.ts` 的 `StorePort.verifySandboxEvidence()` 是呼叫方注入函式；planner 會對結果做 scope、sku、state、時間等檢查，但這**不證明**有官方 Apple x5c／Google Play Developer API 或 RevenueCat 真實驗證。R007/R008 `review_only` 的 typed object、RC 狀態與 synthetic HMAC 都不可作 Store payment proof。**沒有正式 SKU/Store Account／Provider Key 授權**，也不允許引入假帳號。

**B. Server-to-server refund/revoke 不能綁死登入 Session。** 在 `src/index.ts:154-206`，`planSandboxPurchase` 無論 source state 是否 `REFUNDED/CHARGEBACK/REVOKED`，都先要求 `ports.auth.resolveTrustedPrincipal()` → 目前會員 `active`／相同 app/env／server binding；故**不能直接用此 planner 當官方非同步退款 webhook 的減權處理器**，否則會員登出／停權／刪帳可能使官方退款無法撤權。應分**兩個未來 protected server-only ports**：
- Purchase/Restore：current AI-1 signed AuthFence＋官方 Store receipt＋批准商品；
- Refund/Revoke：獨立**已驗證 provider server authority**＋原 immutable lineage＋monotonic revocation/CAS/outbox，同會員即使無 active Session 也可減權；**不得因沒有當下會員登入就拒絕官方減權**。
此新分流未實作，**不可將 legacy sandbox pipeline 註冊為正式 Handler／Webhook／消費者或手動管理退款接口**。

**C. #251 receipt 修正是「審查設計」，非歷史 SQL 已更新。** [原 #251 amendment](./AI2-W1-D87-RECEIPT-IDENTITY-SCOPE-AMENDMENT.v1.json) 指明 `(provider,store_namespace,store_transaction_ref)` 是 receipt identity，`brand_id/app_id/environment` 為可信 scope guard，原六欄只作展開查詢，`store_namespace` 依賴六組隔離維度（brand、app、runtime env、Store app、Store verify env、provider issuer/account namespace）。`(provider,store_namespace,original_transaction_ref)` 是 first-claim，**不能加入會員 ID**；provider lifecycle event key `(provider,store_namespace,provider_event_ref)` 應與 transaction 分開，同 receipt 可有 purchase 與 refund。
- **已存在 `schema/0001_billing_rebuild.DRAFT.sql` 是舊版** `UNIQUE(store_environment,store,store_app_id,original_transaction_id)`，不包含受信任的正式 issuer/account namespace；該 DRAFT 不能當成已證實符合 #251 的最終物理唯一約束，也無最新 `billing_verified_receipt` 正式表。
- `src/billing-d1.ts:80-82` 的候選 `ownerKey` HMAC scope 涵蓋 app/env、store、storeAppId、original id，依賴已注入的暫時 key；**沒有經核准的正式 Store app/issuer 對照**。若不同品牌/App/環境以不同 physical DB 獨立處理，同筆原始交易跨 DB 不會因現在的唯一 index 自動阻擋；需 AI-0 正式裁決 physical transaction authority、registry namespace canonicalization、cross-app rebinding before live。
- **不准**把既有 SQL `billing_atomic_receipt`（以 `idempotency_key` 為鍵的離線 commit guard）誤稱 #251 `billing_verified_receipt`（以官方 Store transaction identity 為鍵）的正式收據模型，或推論本 schema 已通過真 D1 CAS/first-claim/退款/PITR。

**D. P05 source shape 仍不具 release authority。** 舊 `src/billing-d1.ts` 明確檢查 `billing.p05.v1-candidate` 與固定**13-key candidate** 的 `p05` JSON（含 `actor_ref/resource_ref/classification`）；它與業主 D06=A「11 business core＋條件 idempotency、Layer2 獨立安全封套」的最終核准版本**並非同一份正式契約**，而正式 G06「13 欄」尚未有列舉權威來源。不能從這個舊 Sandbox P05 13-key assert 推定 G06 PASS；不能 publish／ACK。

**E. 測試依賴注入不能提升為真交易權限。** `billing-d1.ts` 的 `db.batch` 會在 `createSandboxBillingD1Writer(...).commit(plan)` 被呼叫時執行五段 SQL；目前 public Worker／SDK／mobile startup 並沒有呼叫它。這使其可作**隔離的 source-only 主幹候選**，卻不代表將來誰都可注入真 D1 並安全執行。要防止從 Admin UI、client、AI-3 consumer、public Worker 任意呼叫。未確認正式 Auth CAS fence/anti-PITR/Store authority 前不啟用 writer。*.DRAFT.sql **不得由 CI 或 Startup 遠端 apply**。

## 3｜Main Promotion 包含範圍與處置矩陣

| 分類 | 可否 source-only 納入 main | 不可逾越的部署／實作限制 |
| --- | --- | --- |
| `packages/rebuild-billing/docs/**`，尤其 #249/#251 原始 ADR + amendment | **可候選保留**，但只作歷史／審查契約；二者不可拆開引用 | 不能聲稱已核准 Store/issuer/SQL/G05；不產生 SKU／13項新清單 |
| `src/wave1-{r002…r008}*.ts` 及 R001 review-only source | **可候選保留**，均為 default-OFF／review-only，無 module-init Store API | 不得接 UI／server entitlement writer；RC/Store fake/synthetic 永遠非 Official proof |
| `src/index.ts` Sandbox planner、`src/billing-d1.ts` writer | **可保留作隔離原始候選，但需要「NO PUBLIC ROUTE / NO LIVE BINDINGS」條件** | 正式購買/退款兩條 authority paths 與 #251 namespace/lineage/CAS/真 receipt schema 實作前，**必須 BLOCK runtime promotion** |
| `schema/*DRAFT.sql` | **可作 archival / offline tests** | 任何 production/staging migration、遠端 D1 使用及自動 apply 都需另經業主、AI-0、安全/法遵批准 |
| `.github/workflows/rebuild-billing.yml` 和 root offline gate | **可作離線 CI，因來源看不到真 Store/RC／遠端 migration 命令** | `npm ci`／`npm exec` 可能會從 npm registry 讀取/下載相依套件，這是**依賴來源網路**不是付款網路；`wrangler deploy --dry-run` 不能視為真 Cloudflare deploy PASS |
| `apps/api/src/index.ts`／`wrangler.toml`／public SDK／Expo app dependencies | **目前是 health-only 或開發用，沒有真 Billing entry** | AI-0 需確認 Cloudflare 自動 builds/Preview 與 main merge 的外部後果；不會因 source-only 合併而自動核准實際部署 |

**建議 AI-0：** 現階段只能考慮「source-only main promotion」（等全部 Git Tree SHA 與必須的保護確認），**不得部署已含未審 Billing writer 的可達路由、也不得把 DRAFT SQL 套真 D1**。其他模組 Main Promotion 結論應由對應 Owner 審查，AI-2 不可代替宣稱全 repo 846 檔均已安全。

## 4｜完整 Main vs W2 遞迴 Git Blob-SHA 對照：不能相信 compare 前 300

既有 GitHub compare tool 顯示 W2 相對 main **201 commits ahead、0 behind**，但 `files[]` **只回前 300 個**，**不是 828 變更檔完整比較**。用 300-file API 清單不能證明 main 18 檔全保留。

因此另在**本次 AI-2 獨立 source-review Draft** 增加：

`packages/rebuild-billing/test/ai2-w2-main-promotion-complete-git-tree.test.mjs`

- **只有本 PR 的 GitHub `pull_request` job 才啟動**；其他 branch、main、local 跑測試時 skip，不默默觸發 network。
- 在一次性 GitHub Runner，用 `git fetch --depth=1` **只讀 GitHub Repo 的當前 main、#255 branch refs**；先驗證 ref HEAD 完全等於固定 `8be31e...`／`6ae5c2...`，漂移就 FAIL，不能偷換比較。
- 用 `git ls-tree -r -z --full-tree <SHA>` 取得**所有遞迴 blob object SHA、mode、path**，檢查**每一個既有路徑的 git SHA / mode 完全一致**，再計算 added/removed/modified/unchanged；同時輸出雙方 root `tree` SHA、完整 SHA-256 manifest digest，按 100 records 列 GitHub log，**不只印總數**。
- 以業主指出的 main **18**／W2 **846**／新增 **828**／刪除 **0** 為 Pin，另要求**18 舊檔 0 修改**；若實際 Tree 不同，CI FAIL並停止「source-only 完全保留」宣稱，交 AI-0 審閱差異。
- 這個 test 的唯一對外連線是**Github Actions 上讀取 GitHub 原始碼**（非 Store/RC/Cloudflare，無憑證亦不寫遠端）。受限於当前 Github connector 的 compare 300 筆截斷與本地無公開 GitHub 連線，**只有新 PR 同 SHA CI 真成功／job 原生日誌完整印出 Tree summary 後，才可宣稱 846 SHA 實際全部核對**。沒有 CI 真證據前標記 PENDING，不借用 #255 原同 SHA CI 假充 Tree 驗證。

原 #255 exact source offline [AI-0 CI #40826782670](https://github.com/starry-phd/id/actions/runs/40826782670) **1,894 Node、413 SQLite `:memory:` PASS**、同版 Auth/Billing/Requirements 成功，只代表舊 W2 已完成 offline 測試，**不代表這次完整主幹 Git Tree SHA check 已執行**。

## 5｜固定不可越權條件

1. **AI-0 是唯一**可依業主最新批准執行 main merge／受控部署者。AI-2 只交此 Main Promotion 審查 Draft 和 evidence，自己不 merge/deploy。
2. G00～G10 **11/11 BLOCKED**，G04/G05 evidence=[]，P05/PUBLISHABLE=false、`release_authorization.granted=false`。未批實體 D1/Queues/Store/RC／issuer/Secrets、SKU、Auth Store account binding、refund server authority、privacy retention、PITR witness、paid resources，一律**BLOCK**；專責設計不冒充真平台通過。
3. **若 Git Tree 校驗失敗、Branch SHA 漂移、CI 出現 source network 以外寫入、公開 Worker 導入 Billing 或外部 Cloudflare auto-build/preview 未確認**，AI-0 必須先解決後才選擇 main 操作。任何「GitHub 綠燈」都不是 release 證據。
4. H-Global／繁星回聲完全不介入，Battery FREE、Ads OFF、Expo54 unchanged。

**Rollback：** 關閉本 AI-2 source-review Draft／只棄審查文件與 source-only Git Tree test；#255／main／#249/#251 原始 Git blobs 全都不動。
