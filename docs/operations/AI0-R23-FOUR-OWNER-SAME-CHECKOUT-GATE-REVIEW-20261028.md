# AI-0｜R23 五組同版來源整合與正式發布 Gate 審查（2026-10-28）

> **範圍**：延續 [SBASE 五組已驗整合 #164](https://github.com/starry-phd/id/pull/164)、[AI-0 Cloudflare RCA #165](https://github.com/starry-phd/id/pull/165)，接入四位 Owner 新 R23 真預檢及 AI-0 P0/D-02 規劃。本文描述**候選程式、離線安全測試與未來隔離環境缺口**，不等於 Production／Staging／Store／EAS／會員服務已核准或部署。

## 1. 核對結果：原始資料不重製

- GitHub `starry-phd/id`（Public）、GitHub admin `yukidu`，真正前置中央 R21 SHA `fbd5c03156da700b68c7b5bceb65269cb7c900ec`，五組 SBASE #164 固定 HEAD `11a0c9443ec34c60bcbcf77e1231e4b0f5381e04`；本輪整合父系 #165 HEAD `f8a34d843b38c91b5d9d351ee3d54b27696be9d1`。
- **AI-1 Auth／HTTP Session D1 boundary** [Draft #167](https://github.com/starry-phd/id/pull/167)：HEAD `ff36d6ee732a287458767bad4e4d459579387f65`，3 個新 Git blob、真 WebCrypto/HMAC+本地 Auth SQLite Member/Session read-only principal，候選範圍 development/staging、預設 OFF。未有真 OIDC issuer、JWKS、D1 live、Worker route；[owner CI #40636532054](https://github.com/starry-phd/id/actions/runs/40636532054)、[full #40636532095](https://github.com/starry-phd/id/actions/runs/40636532095) 各 owner HEAD success。
- **AI-2 Store/Billing G04/G05** [Draft #169](https://github.com/starry-phd/id/pull/169)：HEAD `31d2969eb8aa8e7bb5e326c8b3124b92d568a358`，4 個新 blob、官方 Release Manifest＋當前 Wrangler 的本地只讀預檢；`--require-live` 故意拒絕未達外部證據。不是 Store JWS/JWKS/Apple/Google 真交易驗證器；[owner CI #40636672128](https://github.com/starry-phd/id/actions/runs/40636672128)、[full #40636672090](https://github.com/starry-phd/id/actions/runs/40636672090) 成功。
- **AI-3 Audit Queue G07** [Draft #168](https://github.com/starry-phd/id/pull/168)：HEAD `a43fe791395c40ceaba12b06a59007030722b9ce`，3 個新 blob、檢查 GitHub staging Wrangler D1/Queue/DLQ declarations + 官方 Release Gate，**不是 Cloudflare 實體 D1/Queue 查詢**；[full owner CI #40636619518](https://github.com/starry-phd/id/actions/runs/40636619518) 成功。
- **AI-4 Cloudflare Preview 安全預檢** [Draft #166](https://github.com/starry-phd/id/pull/166)：HEAD `55406d54082b0bf54d892697a348dc62ffa2e654`，3 個新 blob，對 root/config/trigger/Preview/實體資源風險離線 fail closed；**Cloudflare #164 真 Build 仍 FAILED**，不是 Preview 已修復；[final owner CI #40636623909](https://github.com/starry-phd/id/actions/runs/40636623909) 成功，前兩次 TS/Lint failed SHA 不作通過證據。
- **AI-0 多 App 未來規劃** [Draft #170](https://github.com/starry-phd/id/pull/170)：HEAD `7f42d3d484705391332472af8325fa0aaeb8fb55`，3 個只新增 Docs/JSON，D-02 A/B/C Repo 決策＋3 個**合成 P0 測試角色**＋12 個**未核准需求假設**；[CI #40637182517](https://github.com/starry-phd/id/actions/runs/40637182517) 完成成功（離線；不是三款實際 App/native builds）。
- **本輪 Git Tree 直接引用上列共 16 個原始 Git Blob SHA**，無複製/修改原檔；列於 [R23 來源 manifest](./r23-20261028-four-owner-source-integration.v1.json)。另有 [同版 Node 實際 Git blob bytes 檢查](../../packages/integration/test/r23-source-blob-and-release-failclosed.test.mjs)，逐檔 SHA-1 Git blob 計算驗證 **16 新＋18 舊 SBASE 檔**，並 assert 官方 Release blocked、P0/Store/Ads/付費權限皆 false。這是來源守恆／安全負測，**不是相同新 HEAD 全量 CI 成功聲明**；必須等待 GitHub Actions 在本整合最終 SHA 真正完成後才能標 Integration Verified。

## 2. 跨 Owner 真實阻塞與 Gate 主持決策

| Gate / 領域 | 已有候選程式與離線測試 | 真外部驗證缺口 | AI-0 本輪決議 |
| --- | --- | --- | --- |
| G00/G01 業務核定與資源 | #164 + #165 + #170 Starry scope/授權策略/Repo 設計 | 正式功能裁決、實體隔離、審核簽署 | **BLOCKED**；D-02 建議先研究 C hybrid，但不授權新 Repo |
| G02/G03 Auth/Session | #167 Auth boundary HMAC/D1 SQLite read-only | 受控真 Worker/API/D1/Apple+Google OIDC PKCE/JWKS、KMS/輪換、刪帳 Q104/Q119 | **BLOCKED**；AI-1 只許設計隔離 staging 見證/負測 |
| G04/G05 Billing | #169 真版控/正式 Gate 預檢，SBASE BillingClient 保持 OFF | D-03 單一 canonical Store provider、真 Sandbox 簽章、退款恢復、Billing D1 commit/outbox | **BLOCKED**；不得 grant entitlement/去廣告，Battery 永遠 FREE |
| G06/G07 P05/Queue | #168 staging G07 離線拒絕、#87 ADR 比較 | 真跨 D1 A/B 一致性、唯一 P05 簽署與合法保存、D1/Queue/DLQ ACK-after-commit、抗 PITR rollback 獨立 witness | **BLOCKED**；不可從假 TOML/同機 SQLite 改為 live |
| G08/G09 API/Native/Preview | #166 Preview 預檢候選、#165 Cloudflare 真失敗日誌 | 獨立 Worker＋Repo/branch+Config/Access/費用/rollback 批准後的 Preview、真 iOS/Android build/Store E2E | **BLOCKED**；**優先選 A：保留現有 id-starry 觸發器不動、不 Push 被監視 #164 branch**；任何隔離 PoC 提案 B 需另行取得業主明確批准 |
| G10 成本/法遵/復原 | #165/170 準備清單 | 已核准 Q104/Q119、付費限制、獨立備份/復原演練、事故與版本回退證據 | **BLOCKED**；未有人工簽署即不可發行 |

**注意**：「選 A」是 AI-0 的**當前保守審查結論（不操作既有觸發器）**，不是改 Cloudflare 設定的批准；「B 隔離 Preview」只是下一輪需業主決策的選項。Cloudflare 曾在 #164 SHA 觸發 `id-starry` Worker `npx wrangler preview` 失敗（缺 `previews` block），其真 Preview 列表空/最新部署仍為舊 SHA；**三組或任何 GitHub CI 綠燈不會修復 Build FAILED**。

## 3. 未來 App 平台、責任與可操作界線

- **App Factory** 目前只產出候選 path plan，沒有建立 3 個 App、真 Bundle/SKU、Ad IDs 或商店 listing。30～50 是平台容量規劃，不是 30～50 已立案、投資核准或承諾上架。
- **D-02**：[AI-0 ADR](./AI0-SBASE-D02-MULTI-APP-REPO-TOPOLOGY-ADR-20261028-DRAFT.md) 比較全 private monorepo、private SDK + 每 App Repo、hybrid 群組 Repo。AI-0 **推薦 hybrid 作可試驗假設**，但正式選型／新 private Repo/存取權與真費用 **NONE/UNAPPROVED**。
- **P0 A/B/C**：3 個合成概念（參考/學習/創作）只作獨立 iOS+Android 原生 Plugin、Auth Guest、Store Sandbox/refund、Ad consent/去廣告、Battery 免費及跨 App 實際拒絕測試的**未執行提案**；沒有商業 App 正式批准。
- **AI-0 不改其他四位 Owner 主資料庫唯一 Writer**。AI-1 session/member、AI-2 Store entitlement、AI-3 Battery/P05/Audit、AI-4 Expo/OpenAPI/Factory/Workers 按自己 Issue/PR 負責。具名外部 App 已交別的 AI 開發，AI-0 只管共用接口與組合，不接管產品實作。H-Global 暫停。
- 正式 R23 [release-readiness.v0.json](../release-readiness/release-readiness.v0.json) G00–G10 **11/11 blocked**、`release_authorization.granted=false`、`deployment_automation.can_auto_deploy=false`、P05/PUBLISHABLE=false。**不得**改 main、正式 Cloudflare Worker/Trigger/D1/Secrets、Store 付款/Ads、EAS/原生付費、H-Global。
- 若需真正可部署的下一步，AI-0 需向業主分別取得**特定隔離環境資源/成本/人員權限/法遵/復原審查核准**；拿到時再依當次權限配置一個真受控 Staging 并留下可核證外部憑據，不能假稱已有。

## 4. 真正「同 SHA 整合通過」的最低規格

1. 新整合 Draft PR 必須以固定最終 HEAD 執行 `.github/workflows/ai0-current-offline-gate.yml`，包括 Strict TS、lint、全部 Node 四 Owner/Integration/Gate、SQLite memory、Expo DEV config、Worker `--dry-run` 及 `--assert-blocked`；如新 SHA failed 則修復再重驗，**不能用 #166～#170 原 Owner 綠燈替代**。
2. 用來源 manifest 與真正 Git blob bytes 測試，確認本輪 16/16 新＋原本 18/18 SBASE 一致、無重複引入或修改全部唯一 Auth/Billing/Battery/Worker/SQL/Workflow。
3. 在 #1/#156/#158 與所有 Owner #2～#5 只要必要一筆精確交接，標註 **New HEAD / Node/SQLite / CI url / Cloudflare failure / 11/11 BLOCKED / no main merge/no live deploy**；Issue 不會自動喚醒四個 ChatGPT 對話，不可聲稱已背景派工。
