# AI-0｜R008 四 Owner 同 SHA 後：真實 Cloudflare 資源盤點 × G00–G10 上線阻塞審閱
**日期：2026-10-29（台灣）｜狀態：READ-ONLY AUDIT／NOT RELEASE APPROVAL**

## A. 已可驗證的本輪成果（來源等級：GitHub Actions）
- 四 Owner R008 真實整合 [OPEN/DRAFT #234](https://github.com/starry-phd/id/pull/234)，exact HEAD `e47c068449b3aca37ddbf5d6d7f4255c2391a7c9`，AI-1 #231、AI-2 #228、AI-3 #232、AI-4 #229 **各 3 個 Git Blob 原件 byte-for-byte 保留，共 12/12**。
- 兩條同 SHA Actions `completed/success`：[AI-0 full offline #40745802066](https://github.com/starry-phd/id/actions/runs/40745802066)、[AI-1 auth #40745803356](https://github.com/starry-phd/id/actions/runs/40745803356)；AI-0 實際日志 **1,776 Node + 413 SQLite :memory: PASS**，strict TypeScript/lint、Expo DEV、Wrangler dry-run／Release blocked 都通過。這是離線可用性／安全負測，**不是**已連真 Store/D1/Queues/正式 Auth。
- 正式 release SSOT `docs/release-readiness/release-readiness.v0.json` 目前 G00–G10 **11/11 blocked**、每 Gate `evidence=[]`、`release_authorization.granted=false`、`deployment_automation.can_auto_deploy=false`。**不能因為 CI 綠燈改為 verified**。

## B. Starry Cloudflare 真實唯讀盤點（已認證 API，非 GitHub 模擬）
2026-10-29 台灣日期、已連線的 **Starry Cloudflare 單一帳戶**，API GET 四個項目均 HTTP 200：
- Workers scripts 列表回傳 **6**：`echo-starry`、`id-starry`、`id-starry-ai1-gate1-preview`、`id-starry-ai2-gate0-preview`、`temp-starry-echo-bridge`、`temp-starry-home-bridge`。存在名稱**不表示**正式路由安全、具有正確 Auth 或目前正在運作。
- D1 database API 回傳 **1**：`echo-starry`。**沒有可據此確認的正式 Auth D1 或 Billing D1**；不能偷換成「已建成會員資料庫」。
- Queues API 回傳 **0**。**尚無真 Queue/DLQ 成功交付的證據**；不可宣稱已可 ACK-after-commit。
- `id-starry` Git Builds 回傳 `previews_enabled=false`、`auto_build_enabled=false`，連線 `starry-phd/id`、正式 branch `main`。**未開 Preview、未改設定、未部署。**
- 這是指定單一 Starry account、單次列表回應的**時間點觀察**。沒有檢查 H-Global 帳戶、不同分頁／其他提供者、Workers 內 secrets、D1 表資料、Cloudflare 帳單、域名流量或真跨品牌隔離。因此 G01/G10 **仍 blocked**。如之後決定測試，再分別驗證實際即時狀態。

機器可讀歷史觀察：`docs/operations/ai0-r008-real-resource-observation-20261029.v1.json`，其中明確寫入 `HISTORICAL_READ_ONLY_ATTESTATION_NOT_A_CONTINUOUS_MONITOR`，不可當成新的 Live Gate。

## C. 11 個正式 Gate：缺件與先後（以正式 release JSON + R10 gap analysis 為準）
| Gate／Owner | 此輪目前可證明什麼 | **仍不可缺少的真實權威證據** | 下一步（僅規劃，不執行） |
|---|---|---|---|
| **G00 SSOT／AI-0** | 來源索引、R008 四 Owner 離線整合 | 首款 App 的正式 MVP、128 項逐項核准/取代/延後 | **業主先決定**首款 Starry App、功能範圍、需求清單 |
| **G01 ISOLATION／AI-0** | Starry account 回傳上述資源名稱 | 實際 Starry/H-Global Auth/D1/Store/Secrets 逐項映射與雙品牌隔離測試 | 分別核對權責與身分/資料邊界；不可因使用同一人維護就視作可混用 |
| **G02 OIDC／AI-1** | Auth CAS/R008 負測離線成功 | Apple/Google 真官方 JWKS、PKCE/state/nonce、callback、金鑰輪換 | 先核准隔離測試身份、Sandbox/Secret 最小權限 |
| **G03 SESSION D1／AI-1** | 單機 SQLite `:memory:` CAS/revoke/snapshot | 真 Auth D1 的撤銷、CAS、復原與安全 migration | 獨立批准 test-only D1 與有界測試 |
| **G04 STORE／AI-2** | Apple/Google/RC 不可信 claim 相互不給權益 | 官方 Store Sandbox 簽章、訂單/退款/重播權威 | 核定首款 App 與可驗證 Sandbox/SKU |
| **G05 BILLING D1／AI-2** | Billing race/outbox 本機審閱 | 真 D1 原子寫入/退款/權益一致性與已核商品 | 核定交易/權益策略並批准安全測試環境 |
| **G06 P05／AI-0** | R008 offline gate 不可發通知／ACK | 唯一正式事件 Schema、publisher/authority、Auth→Billing→Audit 跨服務提交後證據 | **先裁決事件欄位/用途及簽章權威** |
| **G07 AUDIT QUEUE／AI-3** | 本機 P05/P06 late erase/revoke/PITR fail closed | 真 Cloudflare Queues/DLQ、持久 receipt、commit-before-ACK、合法 retention | 暫無真 Queue（本次 API 回傳 0），須先完成架構/隱私及預算核准 |
| **G08 WORKER SDK／AI-4** | 安全 Preview shape 檢查與 Worker dry-run | 隔離 staging 的保護路由/SDK/Auth/Secrets/rollback | 先核准 URL/Access/成本/隔離，勿重開 Preview |
| **G09 DEVICES／AI-4** | Expo54 配置與離線 TS 成功 | 真 iOS TestFlight／Google Play Internal／Web E2E／原生 Login/IAP/Push | 確認首款 App、平台上架帳號與原生打包配額 |
| **G10 OPS／AI-0** | 既有發布封鎖規則與事故草案 | 受控支出限額、權限、隱私/申訴、稽核、真 PITR/備份、事故演練 | 業主簽核安全預算、負責人、回復路線和應變流程 |

以上僅是 **gap analysis**。正式 `release-readiness.v0.json`、Gate statuses/approvals/evidence arrays **一字未改**。

## D. AI-0 發現的架構合約對齊問題（需要裁決，不能靠測試自動決定）
1. **P05 欄位版本**：正式 release G06 的 required evidence 明列「**13 欄／其他事件適用範圍**」，但現有 R006 候選 `AI0_R006_FIELDS` 明列 **17 欄**，且 `AI0_R006_LIVE=false`。這是文件標準與候選進化版的**版本決議缺口**，不直接當作程式 bug，不能擅自把 17 欄發布為正式規格。
2. **跨 D1 一致性**：既有 ADR 候選的「A 單一 Starry 交易權威」或「B 持久 Outbox/Saga」均未被正式核准；不能憑同一 SQLite 本機成功就宣稱跨 DB 具原子性。
3. **Q104/Q119**：合法保留／跨品牌去重、刪帳、撤權、申訴與封存期限仍待業主/法遵判定，不可假定期限或把假獨立 witness 當真抗 PITR。
4. **首款實際 Starry App** 尚未由本 Gate 的 evidence URL 正式核准；即使已有 30–50 App 共用基座規劃也不等於第一款上架產品已被核定。

## E. 下一階段最佳順序
**0. 保留 #234 為不可變且綠燈的 R008 離線合版基準。**

**1. AI-0 現階段能做**：維護此真資源/證據缺口紀錄、整理正式第一款 App/功能核准表、G01 品牌資源映射資料、G06 P05 Schema 對照表（13 vs 17）。此處只讀與文件，不變更帳戶、業主選項或 release flags。

**2. 須業主逐項另行核准**：首款 MVP；P05 Schema 發布版；跨 D1 A/B；Q104/Q119 法律保留/刪除；分離的 staging/Cloudflare D1/Queue/Secret、真 Store/OIDC/EAS、成本上限與回退條款。

**3. 證據齊備後才開 Gate 驗收**：官方真平台測試、可稽核審批 URL、最終受保護部署策略。即使未來所有 Gate 經人工驗證，也不可自行合併 main 或發布。

## F. 禁止操作
未獲業主逐項授權前：**不合 main、不重開 Cloudflare Preview／production automatic builds、不新建／變更真 D1/Queue/R2/Secrets/Store/EAS、不開 Ads、不產生付費、不做 H-Global**。Starry Battery 永遠免費；Expo54 維持。
