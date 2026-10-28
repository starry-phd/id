# AI-4｜Wave1 Round-002｜受保護 OpenAPI 3.1／Owner DTO／P05 Queue 邊界與 Cloudflare Preview 隔離修復建議

> **2026-10-28 · AI-4 #5 · `PROPOSAL_ONLY / OFFLINE_DENY_TESTS / GATE1_PENDING / LIVE=false`**
>
> 輸入：[AI-0 四 Owner 整合 Draft #191](https://github.com/starry-phd/id/pull/191) 固定 HEAD `84a23e6ed31fd5a91675ac46b3ab012d01567df6`、[AI-0 同版 Gate2 PASS / Gate1+3 BLOCKED](https://github.com/starry-phd/id/issues/1#issuecomment-6467052301)、[AI-4 Round-002 派工](https://github.com/starry-phd/id/issues/5#issuecomment-6467065240)、[AI-0 Gate 審查](https://github.com/starry-phd/id/blob/84a23e6ed31fd5a91675ac46b3ab012d01567df6/docs/ai/AI0-WAVE1-FOUR-OWNER-GATE-REVIEW-20261028.md)。遵循 [v1.2 Wave1 決策](https://github.com/starry-phd/id/blob/506e33d68a2b2a069b5a356c0bf4192df7db7463/docs/ai/AI0-WAVE1-EXECUTION-HANDOFF-20261028.md)。

## 1. 真新增程式（絕非真服務）

- `apps/api/src/wave1-r002-protected-route-proposal.ts`：純 TypeScript **3 個未註冊的受保護路由提案＋Owner 真版本常數**，來源直接 import AI-1 `WAVE1_PURCHASE_AUTH_SCHEMA`、AI-2 `WAVE1_BILLING_CONTRACT`、AI-3 `WAVE1_SECURITY_FENCE_VERSION`；`reviewR002ProtectedProposal` 是 **純離線拒絕決策**、無 HTTP handler、無 Token 驗簽、無 fetch/D1/Store/Queue、**任何輸入永不 2xx 或權益開通**。強制禁止 guest / 前端 `isLoggedIn`／mock 取代 AI-1 後端短期簽章憑據，拒絕跨 App/品牌/Prod/奇怪路徑、危險 method、取值 getter。真 auth signed、Store signed 和法遵仍由個別 Owner 審查。
- `apps/api/test/wave1-r002-protected-route-proposal.test.mjs`：12 新測驗真 Owner schema 常數、`apps/api/openapi.yaml` 仍只有 `/v1/health`、真正 Worker `POST` 新路由仍 405／`GET` 404、錯誤 scope/訪客/secret/method/route/claim 全 fail-closed、P05 issuer 唯一、不可 ACK。
- **重要**：`apps/api/openapi.yaml` **不變**；它仍是唯一實際 HTTP API 的 liveness 契約，不要把本「候選路由提案」偷轉成正式 OpenAPI path。也**不修改** `apps/api/src/index.ts`、Auth/Billing/Battery domain writer、原始 SQL、CI、package-lock 或任何 Expo 依賴。

### Proposal-only OpenAPI 3.1 路由差異（此 Markdown 不是可部署規格）

下表是 AI-0 Gate 1 審核用的**候選路由與錯誤碼**，不是已驗證的 HTTP response 或真 Owner 已批准 endpoint。

| 候選 Route（只在文件/typed manifest） | Method | 唯一 domain Owner / 真已存在 offline 合約 | 未來至少應檢查 | 本輪結果 |
|---|---|---|---|---|
| `/v1/identity/purchase-entry-review` | POST | **AI-1 DEV-D** / `starry.auth.purchase-entry.w1.v1-offline` | Q2 訪客免登入免費瀏覽；購買前 server signed Starry ID；Fresh Auth D1 member/session/Provider；意圖不含 PII；取消回原流程 | `503 OWNER_GATE_PENDING` 或安全錯誤 |
| `/v1/billing/entitlement-review` | POST | **AI-2 DEV-B** / `starry.billing.wave1.review.v1-offline` | AI-1 重新驗證身份；Store Server/RevenueCat 簽章/收據、per-App product/SKU/env、兩類 IAP、退款/恢復；mock 永不發權 | `503 OWNER_GATE_PENDING` 或安全錯誤 |
| `/v1/notifications/delivery-review` | POST | **AI-3 DEV-H** / `starry.ai3.wave1.security-fence.v1-candidate` | AI-0 唯一 signed P05 來源、AI-1 event-bound SessionFence、AI-3 durable inbox/consent/Q104/Q119 retention、commit-before-ACK | `503 OWNER_GATE_PENDING` 或安全錯誤 |

**候選用的錯誤語義：** 400 欄位/安全的 JSON shape 錯誤；401 缺 server signed Session / 只有客戶端 UI 宣稱登入；403 跨品牌或 App；404 未列入候選；405 不符路由 method；409 未來由 Owner 定義帳號切換、權益或版本衝突，**本輪不直接實作／發出此碼**；503 無已批准權威、Production 停用、Store/Queue/D1/Keyring 或 Gate 未完成。**不得在公開錯誤 body 泄出 Session/會員 ID、Token、個資、KMS、商店交易明細；本輪 review 是本機物件，不產生任何 HTTP 回應。**

**未來受保護 OpenAPI 3.1 樣例，只有待審草案概念，非 `apps/api/openapi.yaml` 的實際內容：**
```yaml
# DO NOT REGISTER; AI-0/AI-1/AI-2/AI-3 must agree DTO & issuer first.
# /v1/identity/purchase-entry-review:
#   post:
#     security: [{StarryServerSignedSession: []}]
#     responses: {'400': {}, '401': {}, '403': {}, '405': {}, '409': {}, '503': {}}
# billing and notification variants must be separately approved.
```

### P05/Queue Trust 順序與 Domain Owner

`R002_P05_QUEUE_BOUNDARY` 是最小**型別/版本握手提案**，不是第二個 P05 發行者；引用既有 AI-3 fence 版本而不是仿造 AuditMetadata / P05 signed data。未來必需順序：**AI-0 唯一 authoritative signed P05→AI-1 綁定 event_id＋Auth session/version 最新重驗→AI-3 法定保留/通知偏好→AI-3 durable inbox & idempotent receipt→transaction commit 有可驗的獨立 durability→**最後**才可能由唯一 Queue Owner ACK**。任何來源/Scope/權限/法遵不明均 deny，不可在 HTTP body 傳 `verified=true` 冒認真簽章。

本輪 `real_queue_binding=false`、`may_emit_signed_event=false`、`may_enqueue=false`、`may_ack=false`、`verified_live=false`。**#87 D1 A/B、Q104/Q119、P05 單一 issuer 與獨立 anti-PITR witness 都還是正式阻塞**。AI-3 負責 inbox/dedupe/notification，AI-1 負責 Auth，AI-0 批准 canonical issuer；AI-4 僅負責 API/Queue Port 版本提案，不可寫跨域 ledger/DB。

## 2. Cloudflare `id-starry` Workers Builds 真失敗：不操作正式資源的修復前置計畫

- AI-0 #191 的 Cloudflare Check `Workers Builds: id-starry` 為 **completed/failure**，與 #191 GitHub Actions 3/3 success **互相獨立**。前輪 AI-4 Cloudflare API 唯讀 GET 核實 `id-starry` Build UUID `3e420ca9-b786-4851-b4d2-35cd245d20d8`：2026-10-28 10:26 UTC，`npm clean-install` 完成，Wrangler 4.152.0 啟動 `npx wrangler preview`，錯在 **`Your Wrangler configuration is missing a previews block`**；先前另有相同配置事故。**不需要再重複執行 Preview 來證明錯誤**。
- 現有 repo 根未有 Wrangler Preview config；`apps/api/wrangler.toml` 未配置 Preview block。安全候選：AI-0 與業主先做**唯讀**的帳號/Worker identity/源分支觸發器/Cloudflare build root & exact --config 路徑、預算/Access 及 bind targets 審查；再次獲准後才在**全新隔離 Worker/允許分支**測 `[previews]`／隔離變數，並固定 SHA、Build ID、賬單、HTTPS、Access、Rollback。**這是待授權操作清單，不是執行指令**。
- Cloudflare Worker Preview 可能提供可公開存取 URL，也可能和部分真 Service/Workflow Bindings 相互作用；需強制預算／ACL／真 D1/R2/Queue 隔離，不能把正式 `id-starry` 綁成測試環境。正式修復可能涉及已監視的 Cloudflare Build Trigger，**當前 AI-0 選 A：原 Trigger 不動**；不能直接把缺失 block 加入生產 config 就推送。
- 官方參考 https://developers.cloudflare.com/workers/previews/ 、https://developers.cloudflare.com/workers/previews/configuration/ 、https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ 。如版本/參數有變動，開案前需重新核對。**這輪無任何 Cloudflare 寫入/Deploy、無 paid API 或 live D1**。

## 3. Release Gate／API 分工／下一輪

- 上游 #191 **Gate2 offline PASS (3 GitHub Actions)**、但 **Gate1 PARTIAL/BLOCKED**（簽署 Auth→Billing 身分仍無正式 adapter；AI-3 SessionFence＋P05/Queue durability 仍無權威串接；AI-4 公開 HTTP 只有 GET /health），**Gate3 BLOCKED**（真 Store Sandbox、RevenueCat 訂閱、原生 iOS/Android、Cloudflare D1/Preview、法遵、復原證據都未驗）。
- G00–G10 **11/11 BLOCKED**、P05/PUBLISHABLE=false，中央 Free Battery 永遠不可售，Ads OFF、廣告商未選。D01=D 是未來新消費 App 開案時最新穩定 Expo/RN，不是中央 Expo54 立即升級；Q5=B 私有消費 Monorepo 延後首 App 開案，D06 新支出逐筆業主同意；H-Global 工程停止。
- AI-0 Gate1 下一步：審本輪 3 新 Blob / source no-write、由 AI-1/#2 提供正式 signed Session backend boundary 與合法可公開的欄位、AI-2/#3 提供 Store signed webhook / trusted member mapping & per App SKU、AI-3/#4 提供 canonical P05+SessionFence+Durable receipt 時序，決定 400/401/403/404/405/409/503 是否為實際 API error schema；取得批准後才在另一安全 Round 增加真 HTTP endpoint、OpenAPI 3.1 與 SDK codegen，並另做 Sandbox 真實驗收。**這輪沒有請示業主重複已核准的 Q1～Q5 或 D02～D08**。
- 回退：此 PR 只在 AI-4 新 Branch 添加上述程式、測試及本文；關閉 Draft 即撤銷本輪效果，**不需回滾主線、正式 Cloudflare/D1/Queue/Store**。下一輪 AI-0 應建立獨立 **同 Checkout fixed SHA** 的四組增量 Draft 合併實測，未通過不可宣稱發布。

**重現本輪 dry-run 專案測試（由 GitHub CI 執行、不部署）：** `npm ci`、`npm run typecheck`、`npm run lint`、`npm run test`、`npm run ssot:validate`、`npm run mobile:config`、`npm run api:check`（Worker dry-run only）；單獨 `node --experimental-strip-types --test apps/api/test/wave1-r002-protected-route-proposal.test.mjs`。
