# AI-4 W1｜Starry 本人資料：shared Worker／OpenAPI／SDK 接線差異與隔離契約審閱

> **W1 自有審閱交付｜不註冊路由、不新增會員 read handler、不改 shared runtime、不部署**  
> Owner: AI-4（Issue #5）；AI-0 dispatch: [#1](https://github.com/starry-phd/id/issues/1#issuecomment-6479281319)、[W1 #5](https://github.com/starry-phd/id/issues/5#issuecomment-6479256094) 與 [最新 #5 補充](https://github.com/starry-phd/id/issues/5#issuecomment-6488770310)。  
> 固定父系 [#242](https://github.com/starry-phd/id/pull/242) `22d7ab1c127546e9e131810d58fdf7e0ccb17882`；對應機讀差異在 `docs/operations/ai4-w1-shared-self-profile-contract-diff.v1.json`。此報告及 JSON **只新增於 #242 子分支**；#243～#245 是不同 AI-0 子 PR，尚未整合到本子分支，不能在本分支直接匯入它們的模組。

## 1. 審閱基準：已存在的真原件，不能另造 read path

| 實際來源與固定 SHA | 確認事實／對 AI-4 的後續影響 |
| --- | --- |
| [AI-0 #243](https://github.com/starry-phd/id/pull/243) `4638621d3408019a1c3660c8f13177cf2bedea6d` | 128 headings 的唯讀來源佇列，非已核准全部需求；不得重造佇列 |
| [AI-0 #244](https://github.com/starry-phd/id/pull/244) `7965ee9a9b0a80bc595b207382aac75bf7a33548`；`packages/integration/src/ai0-w1-isolated-self-profile.ts` blob `3acd105e0942514cbc24dd8032c3166b484bb5c2` | 已有真正**隔離** GET handler，重用 AI-1 signed bearer/current SQLite 成員及 session + provider subject，最終單次 SELECT 再做授權 fence。既有 handler 預設 OFF，未被 `apps/api/src/index.ts` 登記。**不得在 AI-4 再寫一套 handler。** |
| [AI-0 #245](https://github.com/starry-phd/id/pull/245) `e1b255b014c673439f134ef5a58107a036f4b60f`；`packages/integration/src/ai0-w1-isolated-self-profile-client.ts` blob `f60b4063277b36c180fcece85a47db0482eda641` | 已有預設 OFF、**明確注入 fetchImpl/getBearer** 的 detached client，進行受界限 16 KiB JSON 解碼、五欄精確驗證；不可重寫一份相似 SDK read client |
| #245 standalone `docs/contracts/AI0-W1-ISOLATED-SELF-PROFILE.openapi.json` blob `638d242f3b799a894f8a3587ee3ca48737236cee` | 唯一與 #244/#245 roundtrip 一致的**隔離** OpenAPI 3.1 reference：`servers=[]`、`worker_registered=false`、`release_authorized=false`，不能誤當公開已服務 API |
| #245 同 HEAD [GitHub CI #40823124420](https://github.com/starry-phd/id/actions/runs/40823124420) | `completed/success`：1,838 Node + 413 SQLite memory；包含真 HMAC 和 SQLite 往返，但**僅限該 AI-0 source SHA**，非本 AI-4 分支、公開 SDK、真 Cloudflare D1 或正式 Staging |

**已核准的方向、不能越界**：D00 分階段會員優先；D87 單一交易權威是架構方向，不核准 DB 數量；D06 業務核心＋獨立安全封套是架構方向，不核准 P05 第 13 欄、真 signer/Queue。以上均不自動解除 G00～G10。

## 2. 精確路徑、DTO 與版本衝突（本 W1 設計結論，交 AI-0 審查）

| 面向 | 既有 AI-4／shared 檔（#242） | #244／#245 已實作，建議 canonical | AI-4 接線判斷 |
| --- | --- | --- | --- |
| HTTP 路徑 | `apps/api/openapi.member.DRAFT.yaml` 只有 `GET /v1/member/self`，**未服務** | `GET /v1/starry-id/members/me`，同 #244 handler／#245 client／standalone spec | **採 canonical**；舊路徑保持未服務的歷史草案、**不註冊 alias 或 redirect**；未經 AI-0 裁決前不修改既有草案 |
| 實際 Worker | `apps/api/src/index.ts` 只有 `GET /v1/health`，其他 GET 404、POST 405 | 只有 isolated handler，`SELF_PROFILE_LIVE_ENABLED=false` | 必須 **AI-0 先核准依賴接線與 env/URL/secret 安全邊界**；本 PR 不 import handler、不改 Worker |
| 欄位 | 舊草案要求五欄 | `s_user_id`、`display_name`、`directory_opt_in`、`display_name_public`、`profile_revision`，**正好五欄** | 禁止加第六欄、Email、provider subject、refresh_hash、私有欄位；投影 `additionalProperties=false` |
| Revision | 舊 `profile_revision minimum: 0` | #244 project、#245 validator/spec **`1 <= profile_revision < Number.MAX_SAFE_INTEGER`**，上限 `9007199254740990` | 以 **≥1** 為此 isolated read 契約；不要為迎合舊草案容忍 0，也不改 AI-1 原件 |
| 證明身分 | 既有公開 SDK 只有 liveness，沒有 Auth | 簽章 session + current DB + provider exact association，最後 SELECT 重驗 member/session/app/env/version | 身分**只能**取 server 驗真 principal，不准 client 傳 `s_user_id`、header brand、cookie 或舊 UI 登入旗標來授權 |
| 版本／發布 | `apps/api/openapi.yaml` 只列 health | #245 `0.1.0-draft` standalone，沒有 servers，release=false | 未正式接上 Worker 前不加到公開 shared OpenAPI；SDK 不先 export 不可用 endpoint |
| 原生 app | `apps/mobile/app.json` 是 `phd.starry.id.dev` 開發 ID | #245 尚未提供手機 secure token custody 或真 issuer/provider | 不自行決定 token 儲存、登入 SDK、EAS/正式 bundle；先審安全保管抽象、原生與 Web 不共享存取權 |

**DTO 細節**：`s_user_id` 必須是 `^[A-Za-z0-9._:-]{1,180}$`，`display_name` 可為 `null` 或 trimmed、1～80 字、無控制字元字串；`directory_opt_in` 與 `display_name_public` 嚴格 boolean；revision 是安全整數 `1…9007199254740990`。資料來源是伺服器當下本人記錄，不要推斷另外還有公開搜尋／寫入／會員同步能力。

## 3. 錯誤、HTTP 安全預設：不可把 401 當成可重試的後端故障

| Handler 實際狀態 | #245 detached client 的實際結果 | 未來共享 SDK 允許宣稱的最小語義 |
| --- | --- | --- |
| 200 | `{ok:true,profile}`，且 Content-Type JSON、`Cache-Control:no-store`、五欄 shape 都正確 | 僅當下本人快照；不是可編輯或已同步的個資 |
| 400 URL/query denied | `PROTOCOL_DENIED`（非 client 顯示 400 語義） | 不允許 query/member ID；需要契約審閱而非自動重試 |
| 401 initial auth/signature/current verifier failed | `AUTH_REQUIRED` | **#244 初段 key/DB 失敗也可能被統一為 401**；不能將「一定是 token 過期」當事實；禁止靜默 refresh/retry，必要時由 AI-0/AI-1 裁定分界 |
| 403 final SELECT fence 認證／關聯／版本不再 current | `CURRENT_RECORD_DENIED` | 不回傳舊 profile；必須保留撤權後拒絕語義 |
| 404 unknown host/path、舊 alias | `PROTOCOL_DENIED` | 不新增 alias / redirect；錯位 routing fail closed |
| 405 非 GET / `Allow: GET` | `PROTOCOL_DENIED` | 不允許 mutations；共享 OpenAPI 須列方法限制 |
| 503 disabled、clock／final DB 錯誤、invalid projection | `SERVICE_UNAVAILABLE` | **不得把 503 說成認證成功**；真故障與禁用不可自動重試或揭露 SQL/key 實情 |
| 3xx / wrong response URL / malformed JSON / extra PII / 非 no-store | `PROTOCOL_DENIED` | 不能跟隨 redirect、不能接受快取個資或將錯誤 body/credential 記錄進 logs |
| fetch / transport exception | `SERVICE_UNAVAILABLE` | 無自動 retry；特別禁止將 bearer 外送、在 URL 或 Error trace 顯示 |

**Request 安全底線（#245 已實作並需原樣保留）**：**GET**、`credentials:'omit'`、`redirect:'error'`、`cache:'no-store'`、`Accept:application/json`、`Authorization:Bearer <opaque signed session>`，token 經受控 `getBearer()` port 提供；`fetchImpl` 必須明確注入，禁止 ambient fetch／預設 live URL。Client 的 HTTPS-only origin、不可帶 path/query/fragment/userinfo 檢查**比舊 public Health SDK 更嚴**；不要為了相容健康檢查而鬆綁。

**Response 安全底線（#244 已實作）**：JSON、`Cache-Control:no-store`、`Pragma:no-cache`、`X-Content-Type-Options:nosniff`，包含 deny responses；不得透出 bearer、provider subject、SQL、key details。#245 客戶端接受 16 KiB 上限並拒絕超界，不能在公共 SDK 放大限制或用一般 `response.json()` 取代這個受限 parser。

**尚須 AI-0／AI-1 正式核准**：手機 Keychain/Keystore 及 Web token custody 的安全責任、怎麼取得／失效、跨 origins CORS／Access 控制、401（尤其初段儲存失敗）的政策、絕對 URL/host trusted mapping、issuer/key rotation、exposure/redaction 和安控回滾。**這些是待決，不等於已配置任何秘密或正式登入。**

## 4. Starry G01 logical identity / App／環境隔離（不宣稱 Cloudflare 已存在）

- **候選且與現有程式相符**：`brand_id='starry'`、`app_id='starry-id'`。`apps/api/src/index.ts` 由程式直接輸出 health 的 `brand_id:'starry'`，env 只有 `STARRY_APP_ID`、`STARRY_ENVIRONMENT`，**沒有**獨立經驗證的 `STARRY_BRAND_ID` 綁定。設計上將品牌限制為伺服器的 Starry 常數與經審查的 trusted scope，絕不能取用 client `X-Brand`／app_id 自訂值即授權。
- **Development**：僅候選本機開發，health 可回；受保護會員仍 **DENY/NOT REGISTERED**。沒有證據說 dev app 名稱代表正式註冊。
- **Staging**：目前 Wrangler 配置的 **本機候選**，health 可回；沒有真的 Staging Auth D1／issuer／Access／URL 驗收，受保護 route **DENY/NOT REGISTERED**。#244 測試在獨立 handler explicit `enabled:true`，不能當 Worker Staging 已啟用。
- **Production／未知環境**：現有 Worker 一律 `ENVIRONMENT_DISABLED` **503**，不准因 #245 離線 test pass 自動放行。真 Preview 預設 OFF（歷史 Cloudflare GET，非本輪即時驗證）。所有跨品牌、跨 app、跨 env、惡意 `Origin`／Host、錯 route 必須維持 fail-closed。
- **Expo**：iOS/Android `phd.starry.id.dev`、scheme `starry-id-dev` 是目前 dev 候選。SDK 的 origin 與 API 的 `expectedOrigin` 必須從可信的**環境配置／經 AI-0 審閱的來源**建立，不能從 app 自填資料、任意 request Host、未知 URL 自動推導。未授權建立/修改 D1、Queue、Worker、binding、Secrets、production AppID、EAS 或付費資源。
- D87 **單一交易權威**與 D06 **事件核心/安全封套**不提供 GET 本人資料的新寫入權，也不構成開通 Queue、金流、P05、跨品牌資料串接的許可。

## 5. **未執行的** shared 接線最小差異（AI-0 審閱通過才發下一手 runtime 工作令）

| 唯一 writer AI-4 的檔案 | 將來的確切安全變更 | 本 PR 是否有改 |
| --- | --- | --- |
| `apps/api/src/index.ts` | 以 **#244 原 handler** 加入經 G01 審查的 exact `GET /v1/starry-id/members/me` explicit allowlist；建立 server-side TrustedScope/expectedOrigin/DB/key/clock adapter，受控 feature flag 預設 OFF；非 exact host/path/method、production/unknown env、跨 brand/app 預設 DENY，保留既有 health 行為。handler 非同步回應必須經 Worker fetch integration 審查。 | **NO** |
| `apps/api/openapi.yaml` | 在 Worker 真實註冊並過 contract Gate 之後，**從 #245 standalone OpenAPI** 加入 bearer security、五個 DTO 欄位與 required、revision≥1、200/400/401/403/404/405/503 對應；不要更改既有 health，也不要把舊 `/v1/member/self` 掛為 alias。 | **NO** |
| `packages/sdk/src/index.ts` | 評審 `#245 createIsolatedSelfProfileClient` 的 port 封裝／受保護出口，直接重用 detached client；安全 token custody provider、explicit origin/fetch、no credential/redirect/cache/retry 按上述語義。**不能**在真正 Env/Auth/Security Gate 前 public export 成可用 SDK。 | **NO** |
| `apps/mobile/app.json` | 保留 dev identity；未有正式 app/redirect/custody 決議前，不改原生 AppID／scheme。 | **NO** |
| `apps/api/wrangler.toml`、`.github/workflows/*` | 本階段**不修改** Preview/D1/Queue／正式部署／CI workflow；正式接線後仍須新的獨立本機／同 SHA CI 及適用的授權。 | **NO** |
| `apps/api/openapi.member.DRAFT.yaml` | 舊歷史草案僅供追溯；正式 deprecate/remove 的 GitHub 變更要 AI-0 判斷，不能趁本 W1 動舊 source。 | **NO** |

**重要 merge 陷阱**：#243 → #244 → #245 是 AI-0 的下游 Draft 串；本 AI-4 W1 Branch 按正式工作令**直接從 #242** 建立，**沒有這些新增 source**。不可在本 W1 直接 import 不存在的 #245 detached client，也不能只把 standalone spec 貼到 shared API 造成不存在的 public endpoint。交付本差異後，AI-0 需以原 Git blob source-preserve #243～#245 和本 W1／其他 Owner 的成果，於**新整合 SHA** 驗收後再正式派發 shared runtime。#242 不應被回寫或 rebase，避免影響各 Owner 固定父系。

## 6. 最小本機驗收方案（**本 PR 不重跑已完成的 HMAC/SQLite**）

**AI-0 現有真測試結果已驗證**：#244 handler 八群測試、#245 roundtrip 七群測試，#245 exact SHA [Full offline #40823124420](https://github.com/starry-phd/id/actions/runs/40823124420) **1838 Node + 413 SQLite :memory: SUCCESS**。這是現有測試覆蓋，不是本 AI-4 HEAD 的 CI，也非 live。

未來 **AI-0 正式核准共享接線後**，在含 #244/#245 原始 blobs 的新 checkout，使用既有而非重造驗證：
```sh
node --experimental-strip-types --test apps/api/test/ai0-w1-isolated-self-profile.test.mjs apps/api/test/ai0-w1-self-profile-roundtrip.test.mjs
npm run typecheck
npm run lint
npm test
npm run mobile:config
npm run api:check
node docs/release-readiness/check-release-readiness.mjs --assert-blocked
```
這是**未來執行指令**；`npm run api:check` 是 Wrangler dry-run，不是 Preview/Deploy。將來需針對實際 shared route 新增 exact-path/Origin、health 無退化、invalid auth、revoke/version race、wrong env/brand/app、no alias/no PII/cookies/redirect/retry 的**窄範圍回歸**（優先重用既有 fixture，不重造獨立會員 read path）。測試中 `enabled:true` 只准 in-process，**不得成為已部署配置**。公用 SDK 的 server response 錯誤邊界（初驗 DB 401/final DB 503）是審閱項目，不能擅自改換為假定 503 都可重試。

**本 AI-4 W1 的驗收定義**：2 份新增 docs/operations 路徑（本 MD ＋ machine JSON）、#242 parent 與 #244/#245 真 Blob SHA 來源可追、相異路徑/五欄/revision/HTTP/credentials/default-deny/隔離差異已精確回報；**不新增 synthetic mock、read path、Worker route 或舊 G08/G09 驗收清單**。新 W1 Draft 的 CI 若觸發，只能稱為本文件版本 same-SHA 離線檢查；不能借 #245 不同 SHA 綠燈冒稱整合 PASS。

## 7. 狀態、阻塞、回退

- **本輪可完成**：AI-4 shared contract＋接線差異與本機驗收方案可審閱交接；AI-0 開始下一步 contract review 時不必重新要求業主貼上下游程式。
- **仍受阻**：AI-0 審定 canonical 路徑與 401/503、AI-1 身分/Session／保管／權限界面、Starry G01 部署 env/origin 與 real resource mapping、真官方 issuer/Key/D1/Secrets 權限、G06 13 欄等待決與 Q104/Q119、真 staging/test 成本。這些均非已核准的 runtime／Live。
- **保護**：Gate1 PARTIAL/BLOCKED；既有 Gate2 僅離線；G00–G10 **11/11 BLOCKED**，`P05/PUBLISHABLE=false`、`release_authorization.granted=false`。AdMob OFF、Starry Battery 永久免費、Expo54 不變。**不合併 main、不啟 Preview、不部署、不動真 D1/Queue/Store/OIDC/EAS/Secrets/付費、不介入 H-Global 或繁星回聲**。
- **回退**：關閉本 AI-4 W1 Draft 並丟棄以上兩個**新增** docs/operations 檔。#242 固定父系、AI-0 #243/#244/#245 和 AI-1～4 已有 immutable 原件不變。
