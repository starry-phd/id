# AI-4｜新版 Q89–Q125 第七輪可執行跨端 Policy（2026-10-27）

來源：AI-0 Issue #1 集中決議 `#issuecomment-6425664451`、AI-4 Issue #5 `#issuecomment-6425697689`，第六輪四組整合 Draft #59 固定基線。本工作屬 **owner-approved 規則的內部離線防護程式**，非 Gate 核准／正式部署。

## 交付
- `apps/api/src/staged-policy.ts`：純函數 fail-closed inspect，public health 可在 Auth 故障時保持可用（Q117），其餘 identity/battery/billing/admin/cross-brand **一律 BLOCKED**；剔除假核准、品牌／App／環境／Prototype／getters 及任意公開敏感 API；僅供內部測試，**未掛入 Worker 正式入口**。
- `planStageOrder()`：ID 底座→免費 Battery→Billing 各自離線驗收的先後判斷（Q118），即使三階都 offline_pass 仍 `release_authorized:false`，絕不自動發行。
- `apps/mobile/src/onboarding-preview.ts`：Q93/Q106 的日期／年齡自我聲明預檢、18 歲邊界／閏年負測；沒有保存生日、沒有輸出可作 server age evidence 的核可標記；Q107 所有國家待逐國 Gate，始終不得在前台自行核准註冊。
- `apps/mobile/test/no-standalone-store-app.test.mjs`：現有 `starry-id-dev` 僅是 Expo 開發測試基座，強制留在 dev app identifiers；Q105 正式 Starry ID 是**服務**，不是單獨上架的商店 App。Q108 首期不納入廣告。上架的 Starry 各 App 名稱／bundle/package IDs 待正式 AppRegistry 核准。
- `packages/sdk/src/staged-rollout.preview.ts`：具有固定版本與三階 blocked 的**內部型別預覽**，**不從 public SDK index export**，不接真 HTTP 或用戶身分。
- `apps/api/contracts/staged-rollout.v0.DRAFT.json`：可版本化的批准決議與非批准事項；Q124 App/基座 Kill Switch 僅 `AI_PROPOSED_PENDING_GATE`，絕不假稱可操作。沒有將 Q120/121/123/124/126/127/128 當成 owner-approved。

## 驗證 / 安全
`npm ci`、`npm run typecheck`、`npm run lint`、`npm test`，以及既有 AI-4 / AI-0 same-checkout Actions；測試包含 Q117 Auth 故障、18 歲邊界與錯誤日期、偽造旗標、原型污染／accessors、跨品牌／環境拒絕、依賴階段及非公開 SDK。所有新增 Node 測試無 skip。

此版本未修改 `apps/api/src/index.ts`、`apps/api/openapi.yaml`、`packages/sdk/src/index.ts`、`apps/mobile/app.json` 或其他 AI1/2/3 所有檔；正式 Worker 只有 source `GET /v1/health`，沒有真部署。**G00–G10 11/11 BLOCKED；P05 PUBLISHABLE=false**。不合併 main、不執行 Cloudflare、D1、Queue、Store、Secrets、EAS Build/Update/Workflows、不付費；H-Global 獨立且暫停。
