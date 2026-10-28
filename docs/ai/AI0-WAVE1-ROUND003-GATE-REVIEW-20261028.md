# AI-0｜Wave1 Round-003 四組原件整合＋Q4=A 決議 Gate 1～3｜2026-10-28

## 結論與權威
本 AI-0 新 **Draft** 以 [Q4=A AdMob（Ads OFF）#202](https://github.com/starry-phd/id/pull/202) HEAD `eee3de052f9fc9fb9bc5337fb14e15230687c10b` 作唯一前置整合基準，該基準包含所有 R001/R002 四 Owner 原件及 AI-0 既有跨組安全測試。將 AI-1 R003 [#198](https://github.com/starry-phd/id/pull/198)、AI-2 R003 [#200](https://github.com/starry-phd/id/pull/200)、AI-3 R003 [#199](https://github.com/starry-phd/id/pull/199)、AI-4 R003 [#201](https://github.com/starry-phd/id/pull/201) 的 **12 個原始 Git Blob SHA** 直接加入，0 既有寫入者檔案覆蓋、0 真雲端或 Store 操作。各 Owner R003 上游自己已在 final SHA 離線 CI 成功；本整合**仍需當次新整合 SHA 同時成功**才算 Gate2 offline PASS。

## 主要真正跨組變化
- **AI-1 Auth**：`createOfflineR003IdentityAuthorityPort` 由原 R23 signed Session + Auth D1 current read 導出後端短效／單次消耗的 `signed_auth_d1_review_only`；App/env domain-scope JSON HMAC、KID/epoch、Session switch/revoke fail-closed。不是可公開或寫 Store 的權威。
- **AI-2 Billing**：`createOfflineR003BillingStoreReview` 定義接受**AI-1 R003 型別同版本**之後端 port，做三次 review 及 unverified Store fixture 的競態、退款／回退拒絕。R003 Owner PR 自身只用 structural test double，不是 AI-1 真 Source 的測試。AI-0 新同一 SHA 測試把兩者**真的 import 並組合後在無可信簽章時拒絕**。正向真 Session→實際 Store 的供應者信任與法定 keyring 未驗證，Gate1 不可解封；R002 的不同 NUL fixture digest 也沒有被直接升格。
- **AI-3 P05**：真程式僅 review double snapshot，包括「先 commit、後 ACK」與獨立 anti-PITR witness 形式；來源 `issuer_state:'candidate_unverified'` 不是有效簽名、`readEventAuth` 未接本人真 Session，D1 CAS、真 Queue ACK 未實作。
- **AI-4 OpenAPI/SDK**：新增 inert `R003_UPSTREAM_CANDIDATES`、untrusted Queue 事件順序、錯誤-only DTO。真 Worker/公開 OpenAPI 仍只 `GET /v1/health`，提案 `POST` 均未註冊；不能因 API 候選版就將 P05、Billing、Auth 發布。
- **Ads / Q4=A**：直接沿用 #202 的已核准 `google-admob-mediation` / `ads_enabled=false`；其現有 Q4 覆寫檔與 Node 三測不變。使用者可在 AdMob 原生後台管理廣告排除，不需新增「自家廣告排除後台」前置要求。選商不等於 Ads ON／原生 SDK 安裝/初始化/廣告請求。

## Gate 分級（本檔建立時）
| Gate | 結論 | 可宣稱／不可宣稱 |
|---|---|---|
| 1 協議權威 | **PARTIAL/BLOCKED** | 已建立版本候選、源碼同版可引用及失效測試；**不能**發權、授權 Queue ACK、真 OIDC/Store、Receipt |
| 2 同 SHA 離線 CI | **PENDING** | 必須以新整合 HEAD 真 GitHub Actions 讀回，列三個離線 workflow；另將 Cloudflare Workers Builds 與正式驗收分開 |
| 3 正式發布 | **BLOCKED，G00–G10 11/11** | P05/PUBLISHABLE=false；無真 Store Sandbox、RevenueCat/Apple/Google、Cloudflare Staging/Prod、D1/Queue、原生 Release Build 或付費授權 |

## 下一輪 AI-0 與 Domain Owner 協作
AI-0：本整合 SHA Offline GitHub CI、Cloudflare check 分離採證；必須選定一個合法且可輪替的 canonical P05 issuer/source schema、Q104/Q119、#87 跨資料庫 D1 A/B 與反 PITR witness 再提出真資源／成本／回退的業主選項。AI-1 #2：先在自己 R004 新安全 Draft 建 event_id/actor_ref bound SessionFence 讀取，不假造 issuer。AI-2 #3：基於真 AI-1 Source 的 signed IdentityAuthority 介面互通負測、真 RevenueCat/Store 收據驗證矩陣與逐 App 權益（不打真 Store）。AI-3 #4：用唯一 canonical 簽名事件、SessionFence 與真 durable receipt／PITR 規格做離線失效測試，不 ACK。AI-4 #5：AdMob Mediation Q4=A type-only Ads OFF 契約、受保護 API 漂移，Cloudflare preview missing `previews` 只提供隔離修復計畫。

**工程/安全限制**：不 merge main、不改真 Cloudflare／D1／Queue／Store/RevenueCat/Secrets/EAS、不新增費用、不建立 Q5 延後的 consumer 私有 Monorepo、不升中央 Expo54、不操作 H-Global；Battery 免費，Ads OFF，Starry v1.3 Google Docs 有效。
