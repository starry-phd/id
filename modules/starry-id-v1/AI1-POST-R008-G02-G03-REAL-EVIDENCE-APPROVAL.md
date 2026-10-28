# AI-1｜R008 後 G02／G03 真平台驗收前置批准與證據交接（非新離線測試輪次）
> **狀態：READ-ONLY EVIDENCE PREPARATION / NO LIVE AUTHORIZATION / G02、G03 BLOCKED**  
> 專責：AI-1，Starry 中央會員的 Auth、OIDC、Session、會員／權限。此檔是給業主及 AI-0 使用的**決策及驗收輸入**，不是業主批准，也不是 API/D1 實作或新的 Gate2 成果。

## 1. 精確來源／完成狀態
- 最新已核對的四 Owner R008 單一 SHA [Draft #234](https://github.com/starry-phd/id/pull/234) `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9`；[full offline CI #40745802066](https://github.com/starry-phd/id/actions/runs/40745802066) 與 [Auth CI #40745803356](https://github.com/starry-phd/id/actions/runs/40745803356) **completed/success**：1,776 Node、413 SQLite `:memory:`，僅 offline Gate2。
- AI-1 R008 原始 3 blobs 已位元保留於 #234，源頭 [AI-1 Draft #231](https://github.com/starry-phd/id/pull/231) `d668add2153bae35ec89c55786d368718bdf61f6`；**不重寫、不再製作模擬 CAS**。
- AI-0 後續 [真 Cloudflare 唯讀稽核 #235](https://github.com/starry-phd/id/pull/235)、[P05 來源差異 #236](https://github.com/starry-phd/id/pull/236)、[新對話交接 #237](https://github.com/starry-phd/id/pull/237) 保留不變；本工作直接由 **#237 HEAD `ac99611e00c32c0f5945fb9989807b0dd2dda1a9`** 分支，繼承它們。#237 本次 GitHub 查詢 **無 PR 事件 Workflow Runs**，不將上游其他 SHA 的成功借給它。
- 正式 Release manifest `docs/release-readiness/release-readiness.v0.json`（本 parent blob `0ea2e40692fb2e9f7e0c282ac1ece91ad2c740ba`）**G02-OIDC 和 G03-SESSION-D1 均 blocked、`evidence=[]`、`verified_by=null`、`approval_record_url=null`**；11/11 Gate BLOCKED、`release_authorization.granted=false`。本文不修改該 JSON。

## 2. Current source 說得出的事／不能宣稱的事
| 對象 | 已存在、可審查的候選檔案 | 真平台阻塞 |
|---|---|---|
| G02 Apple／Google OIDC | `src/oidc-crypto.ts` blob `8a277c20...`；`src/round6-provider-authority.ts` blob `4ad08e08...`；`ADR-R23-AUTH-G02-G03-ISOLATED-LIVE-PLAN.md` | 官方 HTTPS/JWKS、真登入測試帳號、client/redirect/PKCE/state/nonce、簽章金鑰輪換、callback 成功及拒絕的獨立外部證據**不存在／未核准** |
| G03 Auth Session D1 | `src/session-persistence.ts` blob `5d691e0f...`；`src/r23-signed-session-d1-request-boundary.ts` blob `95f89cae...`；R008 本機 CAS `src/wave1-round008-auth-session-monotonic-cas.ts` | 真正隔離的 Auth D1 + Worker、受保護路由、真 Auth/current CAS、並發撤權、migration/rollback、PITR nonrollback witness、managed secret、合法刪除**沒有真權威證據** |
| Worker 與綁定 | `apps/api/src/index.ts` blob `a9addff8...` 目前只有 `GET /v1/health` liveness，其他 POST 405；`apps/api/wrangler.toml` blob `55f53e1e...` staging 沒有 D1 bindings | 不可把 liveness route、`wrangler --dry-run` 或測試 SQLite 視為對外受保護 Auth API |
| 既有安全預檢 | `src/r23-auth-g02-g03-live-preflight.ts` blob `83092b48...`，`scripts/r23-auth-preflight.mjs` | 此工具只能讀 GitHub checkout 的靜態來源，設計為 **永遠不提供 Live 授權**；本工作不複製其掃描器或負測 |
| 外部 Starry 帳號 | #235 時間點唯讀 Cloudflare Workers=6；D1 僅 `echo-starry`、Queues=0、`id-starry` Preview/production auto-build OFF | 不是即時監測、不是 Auth D1，也不證明 Secrets/正式會員/費用/跨品牌隔離 |

## 3. AI-1 G02／G03 正式驗收程序（**尚未執行，不是已核准的操作清單**）
每一項都要 **批准紀錄 → 受控測試實體 → 正／負向證據 → 獨立審核**，不先行呼叫官方 OAuth、建立資料庫或部署 Worker。

| 閘門 | 必須在隔離受控環境實測（經額外批准之後） | 必須拒絕／記錄的負向情況 | 最小去敏證據 |
|---|---|---|---|
| **G02 OIDC** | Apple 與 Google 官方 JWKS、issuer/audience、alg/KID 適配與輪替；唯一 callback redirect；PKCE-S256 + state + nonce；authorization code 單次使用、既有會員綁定 | 錯 issuer/audience、錯 nonce、偽造 provider、callback/code replay、過期/替換的 KID、redirect 注入、Token 被替換、狀態重放 | test provider、測試資源假名、ID、時間、SHA、結果、審核員、遮罩報告 URL；**絕不提交真 Token/code/個資** |
| **G03 Session D1** | 已核准 Starry-only test D1 的 migrations UP/DOWN；真 SQL member+provider+session CAS、雙並發 refresh/revoke、AuthVersion、一次性 token、read-after-commit、撤權時效與受保護路由 | 跨 App/env/brand、撤銷後舊 token、刪除後復活、停權與高權限越權、遷移回滾後版本倒退、雙 Worker 併發重播與 PITR 同域回退 | 已核准真 D1 測試實體別名、source SHA、 migration 版本、遮罩結果、獨立非同域 witness 驗證與 rollback 記錄；不提供真正 SID/會員資料 |
| **跨域／Release（AI-0）** | #87 A/B、Q104/Q119、P05 欄位正式選型及受保護發布順序經業主審核 | 只憑 G02/G03 便宣稱 P05/Queue ACK、跨 D1 commit、商店權益或發布 PASS | 業主權威決策 URL／核准資源/費用上限／安全回退與各 Gate 正式 reviewer |

## 4. 可逐項審核的前置批准（全部仍 PENDING）
機讀表：`G02-G03-REAL-EVIDENCE-APPROVALS.v1.json`。此處列條件，**不代替 AI-0／業主核准**：

1. Starry 中央系統 test-only 的 app/env/範圍、操作者與 reviewer，官方 App/client/callback allowlist、Apple／Google 測試帳號與必要權限，限定測試用途。
2. Cloudflare Starry **獨立 test-only** Worker/Auth D1/Access、網域與可識別資源、上限、實際費用／用量、Secrets 保管者、禁止觸及既有 `echo-starry` 或任何 production。
3. #87 Auth transaction/outbox/PITR 外部 witness 擁有者、Q104/Q119 合法保留與刪除條件、session issuer／key custody/rotation、失敗清理／回退與事故處置。
4. AI-0 明確授權 AI-1/AI-4 限定的**真外部測試操作**，指定不可越權的邊界及驗收負責人；即使批准測試也**不等於批准部署 main/Production**。
5. P05 `ADMIN-PREP 11 核心+1 條件 / G06 未列名 13 / 離線投遞 17` 衝突由 AI-0＋業主另行裁決，**不能由 AI-1 補猜第 13 欄**。

## 5. 真實 Gate 的驗證方式與回退
- 未批准前，使用**既存**的 `node modules/starry-id-v1/scripts/r23-auth-preflight.mjs --assert-blocked` 在經核對的工作樹中做只讀封鎖檢查；該命令若 exit 0 只代表「維持 BLOCKED」，非 Live PASS。本 PR **不重跑同舊輪離線測試、不修改 CI**；CI 的 GitHub run/status 必須以新 SHA 當次真實查詢，不能借 #234/#236 成功。
- 每一個日後真正外部驗收項須有來源、提供者回執的**去敏摘要**、resource alias、時間、執行者、獨立 reviewer、approved scope/費用、成功與惡意負測、rollback 和 evidence URL；權威驗證由 AI-0 管 Gate，不由客戶端 `verified=true` 或測試假資料自行放行。
- 禁止主動合併 main、Cloudflare Preview/production Builds 重啟、Preview/Staging/Prod 部署、真 D1/Queues、Apple/Google 真 OAuth 交易、Store/RC/KMS/Secrets/EAS/付費、Ads 或 H-Global/外部「繁星回聲」。Starry Battery 永遠免費、Expo54 保留。
- **Rollback 本 Draft：** close Draft / discard 新 branch，僅撤本 2 份 AI-1 待核准證據文件。R008 四 Owner 原件與 #234～#237/main、現有雲端/帳號完全不受影響。

**最小下一步：** AI-0 在 #1 按上述批准 ID 整理提供給業主的具體選項／預算／合法用途後記錄正式批准；AI-1 在未收到對應逐項批准前**只維持 G02/G03 BLOCKED**。