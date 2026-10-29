# AI-4｜MAIN promotion candidate：精選 Starry 中央健康基座（不直接提升 828 個檔案）

2026-10-29，Owner [AI-4 #5](https://github.com/starry-phd/id/issues/5#issuecomment-6489314208)。**本檔是已實作 promotion 變更的 code review rationale，不是一般 Gate 重複清單**。AI-0 對 main merge / deploy 有獨立業主操作授權 [#1 #6489238005](https://github.com/starry-phd/id/issues/1#issuecomment-6489238005)；**本 Owner 不合 main、不部署、不創建資源**，且操作授權不等於正式 Gate 已過。

## 1. 真正完整 Git 比對（不是 Compare API 前 300 筆）

GitHub REST Git Trees `/git/trees/{commit}?recursive=1` 已分別取出 **main commit `8be31efb3dfba66755f297b315593e33cdacfe39` 的 tree `148dae3aafd548a8690ebf46b7fc6ec557baf7b6`** 與 **AI-0 W2 `#255` `6ae5c2bc5cbf71db715e7e70b18833c4cd6f8a79` 的 tree `6f0550d0201b6e9871756a7ca47ec64476745ce4`**，兩者 `truncated=false`，逐一 `path/type/mode/blob.sha` 比對：main **18 blobs**、#255 **846 blobs**，完整差異 **828 added / 0 modified / 0 deleted**、原 main **18/18 blob identical**。參見同 PR 的機讀全量 828 筆 source SHA [`AI4-MAIN-PROMOTION-RECURSIVE-TREE-DIFF.v1.json`](./AI4-MAIN-PROMOTION-RECURSIVE-TREE-DIFF.v1.json)，是原件範圍完整性證據；**不能宣稱逐行人工已審完 828 個檔案內容**。

新增來源結構：`modules/starry-id-v1` 161、`packages/rebuild-ai3` 137、`packages/rebuild-billing` 107、`apps/api` 93、`docs/operations` 90、`packages/integration` 59、`docs/ai` 58、`.github/workflows` **24**、`apps/mobile` 20、`docs/adr` 17、`docs/requirements` 13、`packages/sdk` 9，另有其他歷史/合約/稽核檔案。所有 828 新增均 `mode=100644`，無在此樹中新增 Symlink/executable/submodule；這**不等於其內容或依賴已受正式安全審查**。

### 工作流程／部署安全裁決

本次讀取 #255 的 24 個額外 Workflow 和 main 已有的 2 個：
- 24 個新 Workflow 主要是 `ai0-*` 重建 union/round 歷史、`ai4-rebuild-*`、Auth/Billing/AI3/Requirements 離線測試或手動回歸；其引入會增加任務觸發、重複 CI 配額與歷史 SHA fetch／`npm exec --yes --package=typescript@5.8.3` 的額外依賴表面。**全數不進本候選**。不應誤將所有舊工作流程變成 main 的正式驗收標準。
- 原 main `.github/workflows/starry-ci.yml` 的 `staging` job 在 main push、`vars.STARRY_STAGING_ENABLED=true` 時，持有 Cloudflare Secret 後能執行 `wrangler deploy --env staging`；原 main `starry-production.yml` 可由 `yukidu` 配合 `STARRY_PRODUCTION_ENABLED=true`、手輸確認及 secrets 執行 `wrangler deploy --env production`。**即使 #255 此刻不主張上線，直接引入 lockfile/Worker 後，原有自動化部署路徑可能由「缺程式」轉成「可嘗試」**。
- 本候選實際修改上述兩個**已存在** workflow：保留 PR/main 的 policy／typecheck／lint／unit test；增加 Expo DEV config、Wrangler staging **--dry-run**、官方 11-Gate `--assert-blocked` 與精選路徑硬拒絕。**整段 staging auto-deploy job 移除**，Production workflow 只保留人工 dispatch 的**硬拒絕 job `exit 1`，不傳入 Cloudflare Secrets、不含 deploy 命令**。這是刻意暫時封鎖部署，而非替 AI-0 已獲得的最終操作授權設永久否決；等實體 Gate/權限/回滾另案核准，應由 AI-0 在**另一個部署專用 PR**評審復原。
- `package-lock.json` 是 #255 原件（**447,153 bytes**），保留鎖定來源、不自行更新 lock／Expo 版本。root `package.json` 僅將命令調整為本候選真正存在的健康 Worker/SDK/Expo 路徑，**保留 typecheck、lint、test** 且另加 dry-run、release blocked、promotion verifier；不包含未提升的 `modules` 或 `packages/integration` 的無效 lint glob，也不將少量健康測試冒充完整 1,894 Node+413 SQLite 套件。

## 2. 已交付的可執行最小 artifact

本 Promotion branch **直接從 main 建立**，不是把 #255 的 200+ Commits merge/rebase 過來。以 **Git 原 blob SHA** 精選：
- `apps/api/src/index.ts`、`apps/api/openapi.yaml`、`apps/api/wrangler.toml`、API workspace package 與 `health.test.mjs`／`openapi-parity.test.mjs`。**正式入口仍只有 `GET /v1/health`**；受保護 Member/Auth、Billing/Admin、H-Global 均不服務；Production/unknown env 503，錯 App 403，未認可路徑 404，沒有 D1/Queues binding。
- `packages/sdk/src/index.ts` 只提供健康檢查及 disabled cross-brand sync；`packages/sdk/test/health.test.mjs` 維持身分/安全邊界。
- `apps/mobile` 保留 Expo54 的 dev App ID 和最小開發頁面 `/`、`/about`，**修改首頁以刪除尚不存在的 /member 連結**；沒有真登入 UI、內購/支付、EAS Build/Store、Ads 或正式 Runtime mapping；加入窄範圍 dev harness 安全測試。
- 官方原始 `docs/release-readiness/release-readiness.v0.json` + validator **按原 Git Blob 不改**：Gate G00–G10 十一項仍全部 `blocked`／`evidence=[]`，`release_authorization.granted=false`，`deployment_automation=false`。
- 自有 `scripts/promotion/verify-curated-release.mjs` 與測試：從實際 git tracked paths、Worker/OpenAPI/Wrangler/Expo/SDK、Workflow 和正式 release JSON 驗證「只提升 approved curated paths」，拒絕 24 個歷史 Workflow、未批准的 member UI/contract/runtime/實體資源、Secrets/Deploy，任一新增 release 權限 fail-closed。

**不是全量 #255 的同版整合**：#255 exact HEAD 的 [Full CI #40826782670](https://github.com/starry-phd/id/actions/runs/40826782670) 1,894 Node/413 SQLite 是另一個完整但未合 main 的離線版本；此候選是**獨立最小基座**，其 CI 必須以本 PR 自己的 HEAD、較小範圍獨立驗證；不得將它稱為 Auth／DB／SDK 會員正式能力通過。完整 #255 已通過的 W1/W2 局部程序和證據原樣留在 #255 Draft，不因本次精選被刪除。

## 3. 明確排除項／不得錯誤宣稱

**刻意不提升 main 的部分**：`modules/starry-id-v1/**`（AI-1 Auth/Session signed/R23/W2 typed adapter 等已測但仍未 Live 核准）、`packages/rebuild-billing/**`、`packages/rebuild-ai3/**`、`packages/integration/**`（含 #244/#245 隔離 handler/client，仍 default-OFF）、`apps/api/test-support/**`（含 AI4 W2 local-only dispatcher）、`apps/api/src/round*/wave1*/r23*/r24*/member-contract*` 歷史候選、`apps/api/contracts/**`、`apps/api/openapi.member.DRAFT.yaml`、`apps/mobile/app/member/**`、其他 Consumer UI/placeholder/Admin/API 候選、24 額外 workflows、歷史 R006 P05 模擬、Queue/EAS/Ads/Store 代碼。

**排除不等於已裁決放棄中央需求**：D00 分階段先會員仍為產品方向，這個 PR 僅為**可安全合 main 的技術底座候選**；第一階段真正會員功能尚未達 Gate，需要 AI-0 另行決定 source-preserve 的安全 promotion 與實體 Staging/DB/issuer/OIDC 權限。D87 單一交易權威、D06 core＋安全封套不在此當作已部署。嚴禁從 `/v1/health` 推定 readiness/user login/live member。

## 4. Cloudflare 真實部署差距、未來 artifact與 rollback

依 [AI-0 唯讀實查](https://github.com/starry-phd/id/issues/1#issuecomment-6489295591)，當時 Starry `id-starry` bindings **[]**、compat date **2026-10-24**、上次既存 deployment **2026-10-25T15:54:34Z**；這是**當時快照**而非本 AI4 新 GET。候選 Wrangler `name=starry-id-api-local` / `[env.staging] name=starry-id-api-staging`、compat **2026-10-01**，與 Cloudflare 真 `id-starry` **名稱/日期皆不同**，而且 `workers_dev=false` 且沒有 D1/Queue/real secrets。**不可直接拿 `api:check` dry-run 當部署結果，更不可把它直接套上現有 `id-starry`**；需 AI-0 日後核准**現有 Worker 資源與 repo artifact mapping**（或另行明確核准新資源）、暴露策略、DNS/Access、成本、rollback 和正式 Gate。

**最小可重現 bundle（僅本地或 Actions dry-run）**：
```sh
npm ci --no-audit --no-fund
npm run typecheck && npm run lint && npm test
npm run mobile:config
npm run api:check                 # Wrangler deploy --dry-run; NO network deploy
npm run release:blocked
npm run promotion:verify
```
原始 `apps/api/wrangler.toml`（不修改任何 Cloudflare external settings）指向 `apps/api/src/index.ts`，唯一公開 API `/v1/health`。**沒有** production 環境、正式會員 D1/issuer；本次只驗可建立安全受限的 Worker artifact，不假裝它可供真會員使用。

**回退（本候選）**：AI-0 尚未合併之前直接關閉 Draft、棄獨立分支，不影響 main/#255/任何真 Worker。若 AI-0 日後核准並 merge，需記錄 merge SHA，先回退該 merge PR 使 main 回到明確的 previous SHA 並重驗 CI（不強推 main、不刪歷史）；**如果另有 AI-0 獨立部署**，依實際 `id-starry` deployment/version ID 和 Cloudflare 受控 rollback 另作操作，不能用 git revert 假稱雲端已回滾，也不能提前執行任何 production mutation。

**檢核範圍與下一手**：Main promotion repo code review 同 CI 僅是技術候選；G00～G10 11/11 BLOCKED／P05/PUBLISHABLE=false／發布驗收 false。AI-0 決策要不要先合 health-only 基座、是否以 approved scope 分段 source-preserve 真 Auth、如何建立經授權的 deploy-only PR；四位 Owner 不可自行合 main 或部署。H-Global、繁星回聲皆非本 PR 工作。
