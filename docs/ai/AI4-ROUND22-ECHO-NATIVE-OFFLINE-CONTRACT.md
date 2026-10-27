# AI-4 R22｜繁星回聲 Echo Web → RN/Expo／Cloudflare 離線 API 與 View Model 契約（專責交接）

**工作基準：** AI-0 Issue #1 R22 [派工 #6449302311](https://github.com/starry-phd/id/issues/1#issuecomment-6449302311)，AI-4 Issue #5 [派工 #6449340479](https://github.com/starry-phd/id/issues/5#issuecomment-6449340479)。已驗 R21 四 Owner 整合 Draft [#148](https://github.com/starry-phd/id/pull/148)，HEAD `fbd5c03156da700b68c7b5bceb65269cb7c900ec`，完整離線 GitHub Actions 3/3 green。AI-0 主控保留首款 App『繁星回聲』命名決議；MVP/Bundle ID/正式發布仍待人工核准。

## 唯讀來源（**不是**新版 Authority）

Legacy [yukidu/Echo-Starry](https://github.com/yukidu/Echo-Starry) `main` **固定原始 Commit `82cbf4f112af57fcfed12ff2f6cf86010c03560e`**；以下由 GitHub fetch_file 直接核實，並保存原 Git blob 用於交接追溯：

| Legacy 檔案 | Blob SHA | 已核實行為與不可繼承項目 |
|---|---|---|
| `src/App.tsx` | `f65f2b910ea8df2ac1e4265ea5a092496c05222a` | 音檔查找/搜尋、播放狀態、分享模態、VIP unlock 記憶、本地 browser URL/search、舊 localStorage/cache；不可重用登入/解鎖權威 |
| `src/components/AudioWorkspacePage.tsx` | `b5a161a3901728bc14c7f3600bf28174abad6f98` | 六個管理頁：上傳、音檔管理、網友音檔、逐字稿、AI 問題、AI 演講者；舊版有按角色/特定帳號判權；新版不能沿用 email/super admin 前端權威、window history 或 DOM |
| `src/components/MiniPlayer.tsx` | `785aa285d598b71451e21a5109dad800037415de` | React Web mini-player、播放速度/控制；RN 需新的 native audio implementation，現階段沒有音訊真的播出 |
| `src/utils/offlineAudio.ts` | `b1669a4445f2712ec140f40cb5a31c62e17f8ea8` | `Cache Storage` 真檔案寫入/驗證、播放進度紀錄、15 天清除、背景下載；不可使用 `window/caches/localStorage` 作 RN 原生離線檔案，須另做 permission+secure storage/expiration 驗證 |
| `worker/index.ts` | `868acf827a7297500f30d73f50a04db6c3929faf` | Cloudflare D1/R2/KV Worker、`/api/r2/upload`、`/api/r2/file/` Range stream、`/share/`、既有 Legacy 路由；**全部不可當成新版正式 API 已核准/可叫用** |
| `worker/transcriptRouter.ts` | `0ccb81865eefe2fcba681d24deaf63911e2e49b6` | 原逐字稿/更正/QA 與 Workflow/Workers AI、Legacy Session/會員、`STARRY_ID_DB` Battery 寫入；**不得複製跨 D1 扣費/加獎、舊 OAuth/Session、paid AI 或受保護資料** |
| `wrangler.toml` | `57310e6adf086e075c001bce3ac5d1098d580727` | 舊環境配置/Cloudflare bindings、Worker/Workflow、R2/D1/KV 路徑；這是參考結構、**不複製真路由/儲存桶/Production bindings/secret/Domain** |

## 舊功能 → 新版功能建議分級（僅 AI-4 初步建議，**不是** MVP 決議）

| 功能 | 新 RN/Expo／Cloudflare 建議 | 這次實際範圍 | 是否需人工核准 |
|---|---|---|---|
| 公開音檔目錄、搜尋、分類 | 新安全定義 catalog list/search，純 TS 篩選規則可參考但不能帶舊身份、URL、音檔內容 | 2 筆內建 demo、搜尋零 Auth/Store/DB | 正式內容權利、公開/私人可見性待審 |
| Mini Player、調速、背景播放、Range 串流 | Expo Router/RN native audio engine；Cloudflare signed media API 另定，必須明訂範圍、離線與失效；不複製 DOM | `player.observe` 只示範 metadata/status，`is_playing=false` | 背景/鎖屏/音檔授權、平台權限均未審 |
| 下載、15 天快取/收聽紀錄 | Native encrypted local file + consent/TTL/quota/rights invalidation；不繼承 CacheStorage | `offline.observe=OFFLINE_NATIVE_ADAPTER_MISSING` | 本地文件/撤銷/保留/刪除權限待審 |
| 逐字稿、字幕、翻譯/更正 | 新 `transcript.observe` 非敏感狀態，R2/Worker/AI 需另簽源及額度 | pending/cancelled/ready_mock ⇒ 不確認完成，無內容及 R2 讀取 | 法律、逐字稿模型/費用與來源待審 |
| AI 問答、AI 演講者、任務 | AI-3 R21 Task/Wallet safe DTO + AI-4 只讀 QA 狀態；不得重用舊 Session/Battery 寫入 | `qa.observe` 接 **實際 AI-3 R21** DTO；不可送真 AI、消耗 Battery | Task durable receipt、P05/法律、Budget 待審 |
| VIP、貼紙、付費內容 | AI-2 R21 Billing safe DTO 僅 `entitlement_unknown/official_store_unverified` 等；Battery 永久免費 | `player.observe` private demo 接 **實際 AI-1/R21 guest + AI-2/R21 billing** DTO，不解鎖 | SKU/IAP/Store/內容分級尚未核准 |
| 分享、訪客進入 | 公開 fixture preview；`/share` legacy token 不當身分、不永久 VIP 解鎖 | `share.observe` 無 URL/會員授權/分享動作 | 真短連結權限/到期/私密性待審 |
| 後台上傳/管理/逐字稿設定 | 管理中心獨立新 Auth/BAC，RBAC 後端驗證；不可使用 Web role/email 判權 | `admin.observe` 實際 AI-1 R21 guest 身分 ⇒ 拒絕 | 建議 **延後 MVP**，審查職責及 Admin route |

## 真正新增離線原碼與可執行測試

- `apps/api/src/round22-echo-offline-view-model.ts`：`createEchoR22OfflineViewModel(scope,revision,ports).resolve({operation,track_ref,query})`，**PRIVATE/OFFLINE-only** 輸入輸出 contract；八個 API *operation names* 不是已上線 Worker endpoints。`catalog.list`, `catalog.search`, `player.observe`, `offline.observe`, `transcript.observe`, `qa.observe`, `share.observe`, `admin.observe`。
- `apps/api/test/round22-echo-offline-view-model.test.mjs`：真 `createOfflineCandidateAuthUI`、真 `createOfflineR21BillingUiProjection`、真 `createOfflineR21CandidateTaskBatteryStatus` R21 read-only Owner factories，五組 **彼此獨立** `node:sqlite :memory:` Auth/Billing/Task/Battery/Saga；讀 AI-1/AI-3 已有原 draft schema 作離線測試，其他用最小 fake table；測 guest 無 DB、公開 mock 音檔/搜尋無敏感輸出、媒體失敗/離線、逐字稿 pending/cancelled、QA source 未驗、VIP/分享不擴權、無正式 session、政策撤銷、非法 brand/env、敵意 getter、沒有 wallet/saga side effect 等。
- 三個 Owner 專責 R22 的新 DTO **不會在此 branch 自動存在**：目前從 #148 實際已存在 R21 safe Owner DTO 真實方法接入。AI-0 R22 整合各 Owner 新版時另做 same-SHA 測試；不可說這次證明 Echo Native 已可直播播放/已完成跨 DB API。
- 輸出只含受限 demo track label/status；**永遠** `source_authoritative=false`, `personal_data_included=false`, `authenticated=false`, `is_playing=false`, `task_completed=false`, `transcript_ready=false`, `vip_unlocked=false`, `paid_entitlement_active=false`, `can_play=false`, `can_download=false`, `can_charge=false`, `can_purchase_battery=false`, `may_ack_queue=false`, `may_publish=false`, `publishable=false`, `live=false`；不含 `audio_url`, token, member_ref, email, share URL, 私人媒體文字或金額。

## AI-0 下一步待人工核定（本輪**未自動作決定**）

1. Echo Native 最小 MVP：公開合法音檔目錄/搜尋/原生播放/字幕/逐字稿是否首發、舊上傳後台是否延後；版權授權與內容可見性。
2. Expo Router 的實際 Screen/Navigation、iOS/Android 播放/離線檔案選型、背景音訊權限、音檔短期簽章 API 與 Cloudflare Data Owner；Bundle/App ID/商店上架主體仍缺。
3. AI-1 官方唯一 Auth/signed P05、Q104/Q119 法律及身份 HMAC/KMS、AI-2 Store/VIP/貼紙真合法 map、AI-3 原生收聽進度與任務/wallet receipt 簽源；#87 A/B 多 D1 決策未定。
4. 付費 Whisper/Workers AI、轉錄、媒體下載、EAS/Store/部署與保留/移轉方式，**都需額外人類明確同意與預算**。

**Release G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false**，不 merge main、不任何 Preview/Staging/Production 部署、不用真 D1/R2/Queue/Secrets/OAuth/Store/EAS/會員/媒體、不可付費或動 H-Global。`Starry Battery` 永遠免費不可賣／兌付費。
