# AI-4 M1｜Starry-only 隔離 Staging 具體能力包（未啟用／不授權）
**來源**：《最新開發技術規範》整合 v1.0／流程 v3.0（含 2026-10-30 S2）；[Issue #220](https://github.com/starry-phd/id/issues/220)、[Issue #5](https://github.com/starry-phd/id/issues/5)。UP-01/02/07/08/09/13/24；P01/P02/P09/P10；G01/G02/G03/G08/G10。

本文件及 [machine-readable draft](AI4-M1-STAGING-RESOURCE-CAPABILITY.v1.json) 是「新建/修改前供業主逐項確認」的**非機密建議與拒絕檢查**，不是資源已存在、測試網站已啟用、費用已核准或 AI-0 已驗收的證據。提交 Draft PR／CI 僅代表 source-only。

## 擬議最小資源（均未建立、名稱為候選）
| 項目 | 隔離候選與用途 | 開通前核驗 |
|---|---|---|
| 管理帳戶 | 僅 Starry 專用 Cloudflare 帳戶；既有正式 Worker `id-starry` 不變 | 唯讀核對 Account ID、Workers Paid 實際訂閱和可用額度；帳號 Email 不放 GitHub 證據 |
| Staging Worker | `id-starry-m1-staging`，獨立於既有 production；先研究 workers.dev HTTPS/callback 相容性 | 真實 hostname、TLS、allowlisted redirect、沒有 public access；未批准不建立/部署 |
| Staging D1 | `id-starry-m1-staging-db`，專屬 Starry 身分/Session 測資，預期 binding `STARRY_SESSION_DB` | 確認 D1 真實資源、遷移/transaction/CAS、最小權限，禁止使用 `echo-starry` 或 legacy archive |
| Google OAuth | 管理端為業主指定 Starry 帳戶（不在 Public Repo 存登入資料） | 唯讀確認 Client、issuer、audience、JWKS、HTTPS callback/redirect、PKCE/state/nonce、專用測試身分，禁止貼 Secret |
| 測試人員 | 業主本人＋明確指定測試身分，其他一律拒絕 | Access 身分與允許名單後端驗證、存取稽核、邀請/撤權/失敗日誌最小化；名單不進 GitHub |
| 密鑰/Session | 由受控秘密管理注入，非 extractable/輪替及隔離；AI-1 Auth owner 實作驗證 | 不使用 repo secrets、測試用 HMAC/RSA 作真憑證；撤權後本人資料必須拒絕 |
| 回退/清理 | 先保留現有 `id-starry`，新 staging 按實際 ID 紀錄建立/變更/關閉 | 帳戶、Worker、D1、OAuth redirect、存取與 Secrets 各自的回退紀錄；不清除其他 App 資料 |

## 新增成本與告警
業主新增月費 **US$10** 是警戒意向，**不是供應商帳單強制硬上限**；既有 Workers Paid US$5 是業主自述、仍待實際核實。核准前要提交固定費、按量 Worker/D1、超額/延遲計費、監控、無硬封頂風險、上限接近時停止可控非必要測試、清理後可能仍產生的費用。任何建立/配置/付費另行逐項確認。

## 環境與驗收出口
1. 本 PR 只對能力宣告執行 `node --test scripts/promotion/m1-staging-readiness.test.mjs` 與既有 CI；無 GitHub Actions deploy，新測試通過也不能解除 G00–G10。
2. 由 AI-0/AI-4 **唯讀** 確認 Cloudflare 及 Google OAuth 真實存在狀態、供應商帳戶映射、環境可用性、成本。後續另開受審的真證據與資源開通工作，不改寫本份歷史快照冒充完成。
3. AI-1 接入 Provider code exchange / 驗證、最小 Session 與撤權；AI-4 僅平台路由、SDK/OpenAPI 與隔離 Staging 整合。需正反 E2E：非邀請者、錯品牌/環境、回呼重播、無效 signature/nonce/state、撤權後拒絕、D1 失敗不發 Session。
4. 既有公開 Worker/SDK/OpenAPI **health-only**，正式 Release Gate 全 blocked；不在本 PR 修改 `wrangler.toml`、D1、Cloudflare、Google OAuth 或 Production。只有真實審批與遠端驗收可推進 Gate。

**交付判準**：能力清單、欄位結構與多項反例可在相同 SHA CI 驗證；遠端平台/費用/審批仍標未驗，不拿 source-only PASS 冒稱 staging 可以用。
