# AI-4｜R008 後續 G08／G09 真實證據與授權缺口清單（僅來源核對，不部署）

**狀態：POST-R008 / SOURCE-LINKED READ-ONLY ENGINEERING AUDIT / ALL RELEASE GATES BLOCKED.**
**本次由業主人工要求繼續，非重做 R008，亦非授權 Stage、Preview、Production、原生 EAS 建置或付費。**
**範圍：** `starry-phd/id` Starry 中央會員系統，AI-4 DEV-G/DEV-I 擁有的 G08 Worker/SDK、G09 Devices/Expo/EAS。禁止對 H-Global／繁星回聲做任何開發。

## 1. 精確依賴鏈與本輪保全

- 上游最新交接原件 [#237](https://github.com/starry-phd/id/pull/237) `ac99611e00c32c0f5945fb9989807b0dd2dda1a9`，父系 [#236](https://github.com/starry-phd/id/pull/236)（P05 欄位權威仍待決）→ [#235](https://github.com/starry-phd/id/pull/235)（真 Cloudflare 單一 Starry 帳戶只讀歷史資源盤點）→ [#234](https://github.com/starry-phd/id/pull/234)（**R008 四組真正同一 SHA 離線整合 PASS**）。
- [#234](https://github.com/starry-phd/id/pull/234) HEAD `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9`：四 Owner 12/12 immutable blobs， [GitHub offline CI #40745802066](https://github.com/starry-phd/id/actions/runs/40745802066) + [Auth #40745803356](https://github.com/starry-phd/id/actions/runs/40745803356) same-SHA SUCCESS；1,776 Node / 413 SQLite in-memory。是 **Gate2 OFFLINE PASS ONLY**，不是 G08/G09 的 live evidence。
- AI-4 原 R008 [#229](https://github.com/starry-phd/id/pull/229) HEAD `faa29e2efb179f413a167933b22b92cbe0df9334` 及 3 原始 blobs 保留，**完全不修改、不重做**。
- #237 為 docs-only Draft，其 exact SHA Actions 在此工作啟動讀取時為零；不可把 #236 或 #234 的不同 SHA Actions 假稱 #237 已驗收。

## 2. 真正 Repo 原件：可證明與不可推斷

| 來源 | 此工作前在 #237 HEAD 的原始 Git blob | 現在確切能說的事 | **不能**證明 |
| --- | --- | --- | --- |
| `apps/api/src/index.ts` | `a9addff8a16c351ee8cbf3900c8aee52e7fb012b` | Development／staging only 的 `GET /v1/health` liveness；其他 POST 405，unknown GET 404；preview/prod env 503 | 任何登入、admin、P05 protected POST 或受保護正式回呼 |
| `apps/api/openapi.yaml` | `2d7d42d8ed9529db5b4e92f895bd83a71702da77` | OpenAPI 3.1 draft 只列 /v1/health GET | Auth、Billing、通知、管理 API 真的存在 |
| `packages/sdk/src/index.ts` | `b73c40bb72c7c2605e9caf77df4ffe6f0d71eee9` | Public liveness client、跨品牌 disabled port | 生產 SDK 可驗 Auth、Store、P05 或 Queue |
| `apps/api/wrangler.toml` | `55f53e1e63349b2ab275d92479d10258af47b6b4` | local / staging-only config；`workers_dev=false`，無實體 D1／Queue／Production／Preview bindings | 受隔離且成功部署的 Cloudflare Staging |
| `apps/mobile/app.json` | `4bf6d502a95038d088f1d2e11f6d050397a1ed41` | Expo **dev** identity `phd.starry.id.dev` (iOS/Android) | 正式 bundle/package 獲批准或已提交商店 |
| `apps/mobile/package.json` | `64f0f38f215dc68b9d49ce520a38bc552764f5a2` | Expo ~54.0.20、Expo Router；dev scripts | 真 EAS build／runtime 更新／簽章／裝置登入/IAP/Push |
| `package.json` | `423a539dfb6cac56c6290bf27bf3d6688d40c11a` | `api:check` 是 `wrangler deploy --dry-run --config apps/api/wrangler.toml --env staging` | Deploy 成功 |
| `.github/workflows/ai0-current-offline-gate.yml` | `ba43a9b1424e621b74d0d7a05e555d61d3be1802` | 讀取權限、TS/lint、Expo config、Worker dry-run、Node/SQLite memory tests | Live Cloudflare/Apple/Google/EAS Store integration |

- 本 Snapshot 讀取時 **未在 Repo root 或 `apps/mobile/` 找到 `eas.json`**；不等於其他系統沒有 EAS 專案/開發者帳號，僅能說這個已查 checkout 無此已知路徑。
- AI-0 [#235 只讀資源盤點](https://github.com/starry-phd/id/pull/235) 曾回傳 Starry Workers 6、D1 名稱 `echo-starry` 1、Queues 0；`id-starry` Build 的 Preview/production auto-build 均 OFF。**是歷史某時間點的單一帳戶列表，不是本輪新 Cloudflare GET、更不是可使用的真 Auth D1 或已驗證費用。**
- 本文件與配套 JSON 記錄的是 GitHub 原件/證據缺口，**不修改** `docs/release-readiness/release-readiness.v0.json`。G08/G09 官方 Gate `evidence=[]`、`status=blocked`。全域 11/11 Gate blocked。

## 3. 待業主與 AI-0 批准後才能跑的最小 G08 真測試

| 前置 | 必須明確提供、核對並留 GitHub 的證據 | 沒有證據時的行為 |
| --- | --- | --- |
| G00/G01/G06 + G02/G03/G07 | Starry ID 中央系統已核准的 MVP、品牌/環境、P05 權威、真 Auth／Session／PITR/Queue 權責；#87、Q104/Q119 仍待決 | 保持 Worker 只有 Health GET，其餘 blocked |
| Cloudflare 隔離與成本 | 業主指定允許的測試帳戶/資源、Access 保護、Preview hostname 暴露、Service binding 是否可能碰正式 Worker、可用額度/收費上限、rollback 責任人 | **不得**重新啟動自動 Preview、建立新 D1/Queue/Secrets、部署 |
| 可觀察整合驗證 | 已核准測試主體／最小身份、staging 真回呼正反測試、真 SDK request/response 不外洩隱私、真受保護路由的未授權拒絕與撤銷後拒絕 | 不能把 `GET /v1/health` 或 dry-run 當 authenticated route readiness |
| 可回退和追溯 | 確切 Worker 版本/環境/URL、Deploy/rollback SHA、審批 URL、時間與執行帳戶，及 revert 真實成功證據 | G08 保持 blocked，不填寫任何 live evidence |

**需求取自** `docs/release-readiness/release-readiness.v0.json` 的 `G08-WORKER-SDK` 兩條 `required_evidence`，沒有自行變更門檻。

## 4. 待核准的 G09 iOS／Android／Web 真驗證

1. 先由業主／AI-0 核准 **Starry 中央 ID** App 的當期 bundle/package/registration、App Store / Play 開發者主體與可公開測試範圍；保留目前 `phd.starry.id.dev` dev 身分，不自行改成正式 ID。
2. 經授權後才盤點 Expo 帳戶、EAS project/Build/Update/Workflows 可用額度／計費、Apple/Google 簽章權限、必要 SDK 升級限制與實際 runtimeVersion 相容矩陣；不得假設 Expo 54 dev 配置已能正式打包。
3. Apple TestFlight／Google Play Internal 安裝結果、裝置與 OS 型號、真 OIDC 登入、沙盒 IAP、推播接受/拒絕與撤銷後行為、Web E2E，都要真平台證據和來源，不得以 `npm test` 或 Expo `config --type public` 替代。
4. EAS Build/Update workflow 的 Job/版本/runtime/更新分支/審查或回退紀錄及**實際** provider 額度與費用/期間幣別，要與 GitHub SHA 交叉比對；不能從任何歷史開發者帳號或 Cloudflare 費率推算確定花費。
5. Gate 所有 evidence、確認者、業主批准 URL 仍由 AI-0 專責獨立驗真；此文件既不是實際 EAS 測試腳本，也不是授權申請完成憑證。

## 5. 本輪新增的可執行自查（不是再做 R008）

`apps/api/test/ai4-g08-g09-evidence-gap-integrity.test.mjs` 是 **來源一致性／不混淆品質守門**：載入配套 JSON 與已存在的 release JSON、確認 G08/G09 owner/status/官方所需證據一字一致、所有 provider/live 認證仍缺、原件 SHA hash 對得上本 checkout、實際 Worker 和 SDK 沒有被當作受保護 API，未放置 EAS 憑證。它無外部呼叫，不會執行 Cloudflare/EAS、修改帳戶或建立費用。

**本次 Gate 結論與下一手**：Gate1 PARTIAL/BLOCKED，Gate2 保留 #234 R008 OFFLINE PASS；本次分支新 CI 單獨驗證，**不是 R009 四 Owner 全面整合或 G08/G09 真人驗證**。Gate3 11/11 BLOCKED、`P05/PUBLISHABLE=false`、`release_authorization.granted=false`。AI-0 請在 #1/#13 逐項蒐集上列真正業主授權、Provider 證據與成本責任人後分派真正實體測試；勿先填 Gate JSON 的 evidence[]。Rollback：關閉本 Draft，移除本輪 3 新增 AI-4-only 檔案，父系 #237/#236/#235/#234 和原 AI4 #229 都不變。Ads OFF、Starry Battery FREE、Expo54、H-Global 暫停。
