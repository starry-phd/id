# AI-4｜Wave1 Round-003｜Protected OpenAPI/SDK Errors + P05/Queue 先提交後 ACK 的離線協作契約

> 2026-10-28 · AI-4 Issue #5 · OFFLINE REVIEW ONLY / DRAFT / NOT REGISTERED / NOT DEPLOYED

## 0. 權威來源與版本（不可拿舊回合當現況）

- AI-0 Round-002 四位 Owner 原碼合版：[OPEN DRAFT #197](https://github.com/starry-phd/id/pull/197)，HEAD 4215bb23bacb709fe3a659a443782032e2a1d5fe；[同版 full CI #40702359128](https://github.com/starry-phd/id/actions/runs/40702359128) success。Gate2 僅 R002 離線 PASS，Gate1 partial/blocked，Gate3 blocked。
- AI-4 R002 [#195](https://github.com/starry-phd/id/pull/195) SHA 06de12c7a229e4fd12544442eedd53701ce572a4 的 3 個原始檔已完整納入 #197，不可重新導入。
- [AI-0 R003 派工](https://github.com/starry-phd/id/issues/5#issuecomment-6471178563)、[Gate #1](https://github.com/starry-phd/id/issues/1#issuecomment-6471159139)、[正式 v2 交接](https://github.com/starry-phd/id/issues/5#issuecomment-6473371885)。
- AI-1 R003 [OPEN DRAFT #198](https://github.com/starry-phd/id/pull/198) HEAD e81788d2e0f2a08eb0bf1d6f9beccbe3dfb1a367；[同 SHA full #40711221966](https://github.com/starry-phd/id/actions/runs/40711221966) success，候選版本 starry.auth.identity-authority.r003.v1-candidate。真簽 Session + 當前 Auth D1 重查只是離線候選，非 Store/Live 授權。
- AI-3 R003 [OPEN DRAFT #199](https://github.com/starry-phd/id/pull/199) HEAD 6b0de28786067e686db6854efa0840d2c120a47d；[同 SHA full #40712491757](https://github.com/starry-phd/id/actions/runs/40712491757) success，候選 starry.ai3.p05.commit-before-ack.r003.v1-candidate。不是實體 D1 原子交易、獨立 anti-PITR witness 或 Queue 真 ACK。
- AI-2 R003 [Issue #3](https://github.com/starry-phd/id/issues/3#issuecomment-6471175859) 已派工，截至本次讀取尚無已核實新 R003 PR／CI。其 R002 #193 已在 #197。

**本 AI-4 R003 分支直接從 #197 SHA 建立**；#198/#199 尚未合入 #197，所以此分支並未把兩組 R003 來源放在同一 checkout 執行。其版本名稱僅作候選兼容參照，不代表 AI-0 Gate1 已核准。

## 1. 此輪真正新增、與 R001/R002 的差異

1. apps/api/src/wave1-r003-protected-interop.ts：版本化 future-only server Port 型別，對接 AI-0 canonical P05 source、AI-1 event/session、AI-3 legal/receipt、AI-0 independent witness、AI-4 Queue transport。沒有具體實作、簽章、金鑰、網路、D1 及 ACK。新增只檢查不可信事件流程**先後順序**的純函式，對完美假資料一樣拒絕；另建立固定、無個資的 SDK **error-only** DTO 候選，無 2xx。
2. apps/api/test/wave1-r003-protected-interop.test.mjs：13 組離線負測，涵蓋過早 ACK、重複／亂序、非法 metadata、偽造 verified/authority、外品牌／非中央 App、Production、getter、公開錯誤遮罩、真 Worker/OpenAPI 仍只含 health。
3. 本文件：獨立列出跨域 Owner / Gate / Cloudflare Preview 須再次核准的隔離修復計畫與回退。

**真實 API 現況：** apps/api/src/index.ts 只有 GET /v1/health；apps/api/openapi.yaml 也只有 /v1/health。R002 三個 protected POST 仍是 PROPOSED_NOT_REGISTERED。此輪沒有把它們註冊為真 Worker HTTP 路由、發布 OpenAPI 路徑或接入 SDK 實際請求。

## 2. P05／Queue 不可越權的正式排序提案

1. AI-0 核定**唯一 canonical signed P05 issuer**、簽章驗證來源/密鑰輪替/版本。HTTP 布林值 signature_verified:true 或 caller:server_asserted 完全不能作為信任證明。
2. AI-1 對 event_id、actor_ref、App／品牌／環境與現行簽章 Session、撤權/會員刪除/版本做最新重查；private digest/session_binding 不可流入公開錯誤或 GitHub。
3. AI-3 核對 Q104/Q119 lawful retention、通知偏好、刪除與保留權；未核准年份不可編造。
4. AI-3 取得 durable idempotent receipt、duplicate/digest 規範、實體寫入一致性；#87 D1 方案 A/B 仍未裁決。
5. AI-0 驗證與 receipt storage **物理獨立** 的 anti-PITR witness、回滾地板與事件提交順序。
6. AI-3 由唯一 domain writer 確認 receipt **physically committed**。
7. 最後才可在另外明確批准後接 AI-4 future Queue ACK transport；**此版本沒有 ACK adapter**。

新 reviewR003QueueSequence 函式的 stages 只是**不可信字串順序**，可拒絕提前 ACK、亂序、缺項、錯誤品牌，但不執行任何上述 Authority Port。不論輸入多像真，may_ack_queue / may_emit_p05 / may_send / may_write_d1 / verified_live 都是 false；完整排列也只回 GATE_NOT_AUTHORIZED。它是負測用診斷器，不是真簽章或原子交易驗證器。

新 proposeR003PublicError 只回 400/401/403/404/405/409/503 的固定 error code 與 Operation unavailable，無動態身分、帳務、Token 或 P05。屬 SDK error-only **提案**，不是 HTTP Response 或部署完成。

## 3. 跨 AI 協作與未核准 Gate

| Owner | 此後必需提供之實證 | 目前 |
|---|---|---|
| AI-0 #1 | 單一 P05 signed issuer / key custody，AI-1↔AI-2 身分規則，Q104/Q119、#87/A-B、獨立 anti-PITR witness，公共錯誤 DTO 最終決議 | BLOCKED |
| AI-1 #2/#198 | server-only event-bound current SessionFence、KID/epoch/rotation/revocation，不可把 digest 當 Store 權利 | CANDIDATE |
| AI-2 #3 | signed Store/RevenueCat 來源、App/SKU 及退款恢復，與 AI-1 真身份映射及錯誤契約 | R003 未核實 |
| AI-3 #4/#199 | lawful retention、atomic durable receipt、dedupe、抗 PITR 及 ACK-after-commit 故障測試 | CANDIDATE |
| AI-4 #5 | 安全 API 與 SDK error proposal、P05 Queue Port 版本、未註冊 route Gate，另行取得 Preview 實體試驗核准 | 本 R003 離線工作 |

ADMIN-PREP P01/P02/P05/P07–P10 僅在職責範圍內預留；P07 的 health 不是 readiness，P09 分開保留 GitHub／Cloudflare／Store 不同來源；P10 不因 DTO 候選啟用 feature flags。不得替 AI-1/2/3 建立域內正式 D1 writer 或管理 UI。

## 4. Cloudflare Preview 已知 FAIL，僅可提出隔離修復核准單

AI-0 #197 的外部 Workers Builds id-starry 仍 completed/failure；前輪 GET-only RCA：Build UUID 3e420ca9-b786-4851-b4d2-35cd245d20d8，npx wrangler preview 因 missing previews block 失敗。GitHub Actions green 是不同驗收面。AI-0 已選 A：既有監看 Trigger 維持原狀，不擅自加入配置觸發 Preview。

**尚待另行業主／AI-0 核准**：獨立 Worker＋單獨 branch / Preview config / Build root / CLI 路徑、Access/公開 URL、非正式 D1/R2/Queue binding、權限與責任人、費用上限／quota、資料隔離、失敗退回／清理方案，再允許單獨隔離 Staging 的來源 SHA + build id + 外部 Check 採證。本輪**沒有操作任何 Cloudflare 資源，也沒有執行 Preview**。

## 5. 測試、發布 Gate、回退、下一輪交接

CI 預期：npm ci；npm run typecheck；npm run lint；npm run test；npm run ssot:validate；npm run mobile:config；npm run api:check（**Wrangler dry-run only**）。焦點負測：node --experimental-strip-types --test apps/api/test/wave1-r003-protected-interop.test.mjs。**此輪 PR 的真正同 HEAD CI URL 和成功/失敗必須在 GitHub Actions 實際跑完後另記錄，不可借用 #197/#198/#199 的 CI。**

Gate1 PARTIAL/BLOCKED；Gate2 **R002 OFFLINE PASS**，R003 待同 SHA CI；Gate3 G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false、release_authorization.granted=false。禁止 main merge、Preview/Staging/Production 部署、雲端 Trigger／Secrets 改動、真 D1/R2/Queue、Store/OIDC/EAS/付費/Ads/H-Global/外部消費 App，中央 Expo54 不升級，Starry Battery 永久免費不可賣。

回退：關閉此獨立 Draft PR，捨棄新增三檔即可；沒有遠端資料或費用需要回退。下一輪交接：PR URL／HEAD SHA／3 個 blob SHA／本 SHA Actions／Gate/阻塞／跨 Owner 需求寫回 AI-4 Issue #5 及 AI-0 #1，必要時精簡通知 #2/#3/#4，完全走 GitHub。
