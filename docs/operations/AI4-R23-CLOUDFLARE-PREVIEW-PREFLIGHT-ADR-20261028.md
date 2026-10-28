# AI-4｜R23 Cloudflare Preview Build 故障：隔離式設定預檢 PoC／回退 ADR

**狀態：`OFFLINE_STATIC_PREFLIGHT_ONLY / CLOUD_PREVIEW_NOT_FIXED`。** 這是 AI-0 [#1 最新交接](https://github.com/starry-phd/id/issues/1#issuecomment-6461120667) 與 AI-4 [Issue #5 差異化派工](https://github.com/starry-phd/id/issues/5#issuecomment-6461112761) 後的**下一個必要開發**，不是重複 SBASE 模型、重新製作另一款 App，亦不是授權更動任何 Cloudflare live trigger。

## 已驗現場與問題精確界線

- [五 Owner SBASE PR #164](https://github.com/starry-phd/id/pull/164) 固定 HEAD `11a0c9443ec34c60bcbcf77e1231e4b0f5381e04`；離線完整 [CI #40633259230](https://github.com/starry-phd/id/actions/runs/40633259230) 在同 SHA 全 PASS。R23 AI-0 [#165](https://github.com/starry-phd/id/pull/165) `f8a34d843b38c91b5d9d351ee3d54b27696be9d1` 僅新增事故證據文件，不能將該新分支當成已核准 live deploy。
- AI-0 **真 Cloudflare GET evidence**：[事故證據檔](https://github.com/starry-phd/id/blob/f8a34d843b38c91b5d9d351ee3d54b27696be9d1/docs/operations/AI0-R23-CLOUDFLARE-PREVIEW-FAILURE-LIVE-EVIDENCE-20261028.md)，Worker `id-starry` 的 Build UUID `239a1aaa-39ff-4e8e-b355-ccfa94edaecc` 由 #164 branch `push_event` 觸發，`root_directory="/"`、命令 `npx wrangler preview`；錯誤 `Your Wrangler configuration is missing a previews block`，**沒有成功 Preview URL**。GitHub CI PASS != Cloudflare Preview PASS；這不是 Production deploy failed 的證據。
- 真 repository **root 沒有** `wrangler.toml`；唯一 `apps/api/wrangler.toml`（Git Blob `55f53e1e63349b2ab275d92479d10258af47b6b4`）有 `[env.staging]` 但無 `[previews]`。根 `package.json` 鎖定 `wrangler ^4.45.0`；Build 日誌用 Wrangler 4.152.0，**版本來源必須核對 lockfile／Build command**，不能只說「本機 dry-run PASS」。截至 2026-10-28，官方 **Worker Previews 要求 Wrangler 4.135.0+**；而目前根 package 的 declared lower bound 不足以保證新 preview 指令可用。
- 舊 Worker 本身 Cloudflare Preview 是 branch-only 的**另一種部署**，不是 `wrangler deploy --dry-run`；實際 `wrangler preview` 會寫遠端 Preview，**本輪絕不執行**。在相同 Worker 名下的 Preview 除了可有獨立綁定，部分 Workflow／Service binding 仍會接到既有/正式服務；Preview URL 預設公開，要另用 Access 保護。不能只加 `[previews]` 就視為安全完成。

## 本輪實際新增原碼：阻止誤觸的預檢器

- `apps/api/src/r23-cloudflare-preview-preflight.ts`：`auditR23CloudflarePreview(input)` 是**純函式、無任何網路/CLI/File IO**；對 `root_directory`、`preview_command`、branch allowlist、Worker 名稱、Wrangler 最低版本、可追溯的 config path/content 執行保守的**安全候選**審查。
- `apps/api/test/r23-cloudflare-preview-preflight.test.mjs`：使用真的 `apps/api/wrangler.toml` 與根 `package.json` 做 **RCA failing configuration regression**，另用**完全合成** Preview-only config 測試理論上「設定候選」；嚴格拒絕舊 `id-starry` Worker、main/外組/舊 #164 監聽分支、wildcard Trigger、`wrangler deploy`、缺 `--config`、過舊 Wrangler、DB/R2/Queue/Workflow/Service/route bindings、機密欄位與惡意 getter。即使 configuration candidate pass 也**永遠** `may_run_build=false`、`may_create_preview=false`、`may_deploy_production=false`；不產生可執行檔、外部 URLs 或憑證。
- **這不是全功能 TOML parser/官方 Wrangler dry-run**：只白名單審核固定、安全、保守的合成 fixture。真 Preview 必須另以當期 Wrangler schema／Cloudflare dashboard 等審批和非正式隔離環境實測。**本輪沒有把 `apps/api/wrangler.toml` 或 root package/lockfile 改掉。**

## AI-0 需審查的兩種互斥路徑（本次均未執行）

| 路徑 | 建議 | 限制 |
|---|---|---|
| **A. 優先：暫緩現有 `id-starry` Cloudflare Builds** | 先完成只讀觸發器/權限/成本/生產路由實體確認。由 AI-0 與業主明確批准後，另安排設定調整操作與回復。GitHub Dry-run 持續驗證，不重複觸發已知失敗 Build | 不要自行關閉 Trigger；現有觸發器仍可能隨 #164 分支寫入而跑 |
| **B. 可選：完全隔離 Preview PoC** | **另行核准**測試 Worker / 分支 / 獨立配置檔（例如非正式名稱 `apps/api/wrangler.preview.poc.toml`）；候選 cloud Build root `/`、Preview 命令 `npx wrangler preview --config apps/api/wrangler.preview.poc.toml`、branch allowlist 一條 **未被舊 trigger 監聽** 的 `ai4/r23-...` 分支。PoC 用 Wrangler >=4.135、核准的 preview block、Dev/Test vars、無正式 D1/R2/Queue/Service/Workflow，且必須評估 Public URL/Access 與計費風險 | 這些是**候選示例，不是已生效配置，也不是已核准 account/workers.dev URL**；Cloudflare new Worker、Build 連結、Preview URL 都可能改動雲端狀態、消耗額度，需業主當次授權 |

**候選（僅文件示意，**不提交成真正 root `wrangler.toml`**）：**
```toml
name = "starry-id-api-preview-r23-isolated"
main = "src/index.ts"
compatibility_date = "2026-10-28"
[previews]
[previews.vars]
STARRY_ENVIRONMENT = "staging"
STARRY_APP_ID = "starry-id"
```

此示意使用 `apps/api/` 內同路徑相對 `src/index.ts`，不是根目錄 `main`；**所有真環境的身份資源與 Preview 目標 Worker 在實際執行前必須獨立核對，不能用此示意直接指向 `id-starry`。**

### 真 Cloudflare 改動前 Gate（本次全 PENDING）

1. AI-0 確認 Worker `id-starry` 目前的正式 Preview/Production 分支、root、API token scopes、Triggers、既有部署；核對 Preview beta 政策／取消策略與失敗 Build 通知。任何跨品牌權限都不允許。
2. 業主**另行批准**是否變更 Trigger 或新建非正式 Worker／測試環境／可能費用。注意 Preview URL 預設 public，使用 Access 將身份／管理操作保護。
3. 如果核准 B，**只**在獨立 PoC repo/branch 使用正式 SDK Schema 驗證 preview block、Wrangler >=4.135、Cloudflare root/--config 參數與 isolated Worker name；避免任何真 Session/D1/R2/Queues/Service/Workflow bindings，也不能把現有 `id-starry` production 當 sandbox。
4. 執行真 Preview 前核對成本上限、配額與回滾；觀察該**新 SHA** Cloudflare Build logs、Preview deployment ID、URL 安全、HTTP `/v1/health`、拒絕未定義的 Member/OIDC/Admin API；**成功的 URL 也不等於中央會員發布通過**。
5. 若只需原 Cloudflare Builds 恢復，不代表一定要採 Worker Previews；先由 AI-0 評估隔離/未來正式部署的最小風險路徑，舊 Build 設定不要當作已核准的正式 Pipeline。

## 官方文件（2026-10-28 查核）

- https://developers.cloudflare.com/workers/previews/ ：Worker Preview 獨立變數、Worker Preview 最低 Wrangler 版本、URL 與部分共享/非隔離綁定限制。
- https://developers.cloudflare.com/workers/previews/get-started/ ：`[previews.vars]` 候選配置。
- https://developers.cloudflare.com/workers/wrangler/commands/workers/ ：`preview --config` CLI。
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/ ：branch preview/production builds 與現有 Worker 的不可逆遷移注意。
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ ：Build root directory、Preview command、API token 等配置來源。

**回退：** 本次 branch 只新增 AI-4 的 inert 檔案；關閉 Draft PR 即回退本輪程式，**沒有任何 Cloudflare/D1/Store/GitHub main 狀態需要回滾**。若後續真的設置 Cloudflare Trigger/Worker，需要執行前保存設定快照、基於審批的回退方案和權限稽核。

**發布權威：** 中央 R23 G00–G10 **11/11 BLOCKED**、P05/PUBLISHABLE=false、`release_authorization.granted=false`。AI-1 唯一 Auth、AI-2 Billing、AI-3 免費 Battery/稽核、AI-4 API/DevOps 的原始 source/DB 不修改；R21/SBASE 全部同版成果保留。無 main merge、Cloudflare Builds/Preview/Production、D1/Queue/Store/EAS、Secrets、付費、H-Global、外部特定 App 開發。
