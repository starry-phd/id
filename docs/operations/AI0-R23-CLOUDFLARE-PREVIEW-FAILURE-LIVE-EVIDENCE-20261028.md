# AI-0｜R23 中央會員發布前置證據：Cloudflare #164 Preview Build 事故核證（2026-10-28）

> **狀態：LIVE-READ-ONLY-INCIDENT-VERIFIED / RELEASE-BLOCKED。** 本文是新的 Cloudflare 真實只讀診斷證據，**不是修復完成、Preview 上線、Production 異動或發布核准**。來源：[AI-0 #1](https://github.com/starry-phd/id/issues/1)、[SBASE #156](https://github.com/starry-phd/id/issues/156)、[R23 基礎 Draft #164](https://github.com/starry-phd/id/pull/164)；後續只依 GitHub 最新 SHA/CI 更新，不改動原始 18 個 Git Blobs。

## 1. 基線、邊界與可重現證據

| 證據 | 2026-10-28 實際核證結果 |
| --- | --- |
| GitHub repo / 權限 | `starry-phd/id`、Public；以 `yukidu` 確認讀寫/管理權限。**Public 不可放正式祕密、會員個資或未核准的私有 App 原碼。** |
| 集成 PR | [#164](https://github.com/starry-phd/id/pull/164) OPEN/DRAFT、HEAD `11a0c9443ec34c60bcbcf77e1231e4b0f5381e04`、R21 base `fbd5c03156da700b68c7b5bceb65269cb7c900ec`；21/21 新增檔案，原始 18 Owner/AI-0 blobs 不再重做 |
| GitHub Actions（原始 HEAD） | [完整 Offline Gate #40633259230](https://github.com/starry-phd/id/actions/runs/40633259230) completed/success：1,151/1,151 Node、304/304 SQLite :memory:、TS/lint、Expo config、Workers **dry-run**、11/11 official release blocked assert；同版 [AI-1 #40633259070](https://github.com/starry-phd/id/actions/runs/40633259070)、[AI-2 #40633259205](https://github.com/starry-phd/id/actions/runs/40633259205) success |
| Cloudflare Build（實測） | Worker `id-starry`；build UUID `239a1aaa-39ff-4e8e-b355-ccfa94edaecc`，created `2026-10-28T04:36:11Z`、stopped `2026-10-28T04:38:01Z`，`build_outcome=fail`，`status=stopped`；來源 PR 機器人 [留言 #6460773562](https://github.com/starry-phd/id/pull/164#issuecomment-6460773562) |
| Cloudflare 真正觸發器 | 只讀 API `GET /accounts/{account_id}/builds/builds/{build_uuid}` 及 `GET /accounts/{account_id}/builds/workers/{external_script_id}/triggers`：`push_event`、branch `ai0/sbase-20261028-five-owner-single-checkout`、path `*`、root `/`、`build_command=""`、`deploy_command="npx wrangler preview"`；觸發器建立 `2026-10-28T04:35:56Z` |
| 精確失敗原因 | Cloudflare Build **日誌**先完成 clone 與 `npm clean-install`（845 packages），再執行 `npx wrangler preview`；Wrangler 4.152.0 回覆：`Your Wrangler configuration is missing a \`previews\` block to run this command`。錯在**Preview 建置設定/命令**，不是這次 GitHub 離線整合測試失敗的證據 |
| 既有設定對照 | #164 HEAD 中 repo 根目錄 `package.json` 無 `wrangler.toml`；`apps/api/wrangler.toml` 有 development/staging-only 設定，**未設 previews**。Cloudflare Build root `/` 與預設 `npx wrangler preview` 未指定 `--config apps/api/wrangler.toml` |
| Preview 與部署 | Cloudflare `GET .../builds/workers/.../previews` 回傳空陣列；Cloudflare `id-starry` Worker deployments 列表最新為 `2026-10-25T15:54:34Z`（歷史 Wrangler 部署，非此 SHA）。**沒有本次 build 成功 Preview/正式部署的證據**；尚未作全面 domain/路由/請求側驗證，不能擴大聲稱所有正式環境絕對未受其他操作影響 |
| 觸發器風險 | 同一觸發器還記有父 SHA `fbd5c031...` 的失敗 Build `dfa2e461-b40e-48fe-8dd7-d5f8ac759a81`；因此**不要再 Push 被 `branch_includes` 指定的 #164 分支以求重試** |

Cloudflare API 僅執行 GET，未改 Build trigger、Deploy hook、Worker、D1、Secrets、Production、Preview 設定，也沒有付費或重新觸發 Build。Cloudflare dashboard 對應失敗記錄：[Build #239a1aaa](https://dash.cloudflare.com/?to=/9ff1b4c261141730ac2fe0683f730062/workers/services/view/id-starry/production/builds/239a1aaa-39ff-4e8e-b355-ccfa94edaecc)。

## 2. Release readiness：不要把 code_exists 與 verified_live 混成一欄

採用本輪交接定義：`code_exists` = 有候選原碼；`verified_offline` = GitHub 同版 TS/Node/SQLite/dry-run 已驗；`verified_live` = 對該 Gate 的真實受控外部系統證據已核；`blocked` = 官方 Gate 尚未通過。**CI PASS 不能替代 verified_live。**

| 主要依賴／官方 Gate | 目前證據級別 | 下一份不可省略的實證與 owner |
| --- | --- | --- |
| G00/G01｜正式範圍／資源隔離 | 核准與真資源映射 **BLOCKED**；#164 只驗證離線 Starry 限制 | **AI-0**：業主核准的中央 MVP 來源清單、每品牌實際資源與最小授權；H-Global 不施工 |
| G02/G03｜OIDC/JWKS、Session/Auth D1 | `AuthClient` **code_exists + verified_offline**；真 issuer、官方 callback、真 D1 未驗，**BLOCKED** | **AI-1**：正式／隔離 staging 身分與 issuer、PKCE/JWKS 及撤權、合規資料保留的實際可重現紀錄 |
| G04/G05｜Store/Billing D1 | `BillingClient` **code_exists + verified_offline**；RevenueCat、自建 Store、真 Sandbox、D1 原子性未核，**BLOCKED** | **AI-2**：單一 Store 權威選型、官方 sandbox 驗證、退款/重放/跨 App 權益、D1 與 #87 的一致性 |
| G06/G07｜唯一 P05、Audit Queue/DLQ | `BatteryClient`/Audit 重試候選 **code_exists + verified_offline**；唯一正式簽署者、跨 D1 commit→Queue ACK、獨立不可回退 witness 未驗，**BLOCKED** | **AI-0 + AI-3**：P05 簽署／責任權威、#87 ADR、Q104/Q119 法遵與真 Queue/D1 恢復證據 |
| G08/G09｜Worker/API/SDK、原生裝置 | `AppFactory` 路徑計畫 **code_exists + verified_offline**；Cloudflare Preview **已證實 fail**、Expo58/native/Store/EAS 未做，**BLOCKED** | **AI-4**：先提出安全修復/隔離 PoC 計畫（見下），再於另行核准後驗證真 Preview、App/商店和回滾 |
| G10｜監控、成本、復原、上線批准 | **BLOCKED**；未見批准、真復原演練或可出示的保護性證據 | **AI-0**：高風險核准來源、合法保留／刪帳、成本/警報、獨立備份/復原演練、回滾與負責人 |

官方基準只能讀取 [`docs/release-readiness/release-readiness.v0.json`](https://github.com/starry-phd/id/blob/11a0c9443ec34c60bcbcf77e1231e4b0f5381e04/docs/release-readiness/release-readiness.v0.json)：G00–G10 11/11 `blocked`、`release_authorization.granted=false`、`deployment_automation.can_auto_deploy=false`、P05/PUBLISHABLE=false。**本文不改或解鎖該正式檔。**

## 3. 具體修復分工與安全路徑

1. **AI-4（所屬 Issue #5）**先提出一個**僅候選/不接正式環境**的 Cloudflare Preview build 設定修復：核對 GitHub → Cloudflare Trigger 的 `root_directory`、`deploy_command`、Wrangler config 檔實際尋址；若擬使用 `wrangler preview`，需按官方當期規格審查 `previews` block。評估 beta 指令風險及是否要建立完全隔離的開發 Worker。**不能只為消除 FAILED 就打開正式部署。**
2. **AI-0**要求提供變更前後的「Preview-only 隔離／無 Production 綁定／Trigger 精確分支路徑／資源費用」審核資料。這一步**尚未批准修改 Cloudflare 真設定**；不得自行關閉、修改 Trigger 或 Push #164 原分支造成自動重試。
3. **AI-0／AI-1／AI-2／AI-3**沿 R23 既有 Gate 及 #87 ADR 補真實缺口的測試規格、必要 Adapter 或受控隔離驗收提案；先收集合規/授權/資源證據，再由業主明確批准任何 Production、真會員 D1、Store、EAS、付費服務等操作。
4. **SBASE D-01～D-08** 保持 `CANDIDATE / POC_REQUIRED / UNAPPROVED`，不升級目前 Expo54/RN0.81.5、不把免費 Battery 改成商品、不把 H-Global 或具名外部 App 加進這次開發。
5. 本 AI-0 新證據分支**從 #164 固定 SHA 起**，只新增 AI-0 自己的事故/Readiness 檔案並以 Draft PR 交付。原中央/Auth/Billing/Battery/Factory、18 Git blobs、main、Cloudflare、Store、D1、Secrets、正式權限皆不更動；CI 新 SHA 需重新讀取，尚未驗證時不得沿用上輪成功宣稱。

## 4. 接棒索引

- [最新五組交接 #164](https://github.com/starry-phd/id/pull/164#issuecomment-6461013850)；[中央 Gate #1](https://github.com/starry-phd/id/issues/1)；[SBASE #156](https://github.com/starry-phd/id/issues/156)；[跨 D1 ADR #87](https://github.com/starry-phd/id/issues/87)。
- 給 **AI-4 #5**：Cloudflare Preview RCA 與安全修復 proposal（**不是已核准 live change**）；給 **AI-1 #2、AI-2 #3、AI-3 #4**：維持唯一領域 writer，逐項回報可真實驗證的 R23 release blocker。
- **AI-0 自身下一步**：審核正式 R23 版本／授權、#87 選項與 P05、Q104/Q119、受保護外部證據，不再做一輪重複四 Owner DTO。所有交接寫回 GitHub；Issue 留言不會自動喚醒其他 ChatGPT 對話。
