# AI-0｜DEV-G API 專責移交前的現況盤點（2026-10-26）

來源：AI-0 五組第五輪離線整合 [Draft PR #52](https://github.com/starry-phd/id/pull/52)，固定 `b4e34c4dc1fc9425e8c2730e7d2421fcbb87d4f0`；原始 [DEV-G｜OpenAPI、SDK、API 管理與跨系同步](https://docs.google.com/document/d/1ZHgNd7tvaddQVvaGZHZbmF3UrQwpqOUaxrYEzW3X_xk/edit)，及 [DEV-I｜Expo/DevOps](https://docs.google.com/document/d/1dsMcGBT5PO43aQVMhZOBO5uyNTE8QHYSnBmC4y2rMSI/edit)。

**重要：API-5 只是建議增聘的 AI 專責，尚未獲業主正式核准；現在 API/SDK/Worker 仍屬 AI-4。** 此文件是只讀程式盤點及移交草案，不會啟動 AI-5、移動 Owner 檔案、上線或部署。

## 可核對的程式現況
| 介面／組件 | 現況 | 來源 |
| --- | --- | --- |
| `GET /v1/health` | Worker 源碼唯一實作 liveness；不代表真實部署或 readiness | `apps/api/src/index.ts` + `apps/api/openapi.yaml` |
| `GET /v1/member/self` | **候選，未掛到 Worker 入口**，需正式 Session/D1 授權 | `apps/api/src/member-contract.ts` + `apps/api/openapi.member.DRAFT.yaml` |
| Starry 公開 TypeScript SDK | 只輸出 health 客戶端與已禁用的跨品牌 stub | `packages/sdk/src/index.ts` |
| 會員 SDK | **僅 preview、未由 public index export** | `packages/sdk/src/member-preview.ts` |
| Billing P05 | 13 欄內部事件工程候選、`PUBLISHABLE=false`，不是 HTTP API | `packages/ai0-contracts/src/p05-candidate.mjs` |
| App Auth | mobile/member 樣板，功能旗標關閉，尚無官方實機串接 | `apps/mobile/src/member-service.ts` |
| H-Global | 現在未實作，應保留獨立認證、Cloudflare、會員 D1 與 API | `docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md` |

## 建議將來 API-5 接手的 DEV-G 範圍（尚未正式分工）
- 管理版本化 OpenAPI 3.x、SDK 生成與發版流程；兼容性檢查、breaking change、相容期限、依賴 App 清單及變更通知。
- 管理 app_id／brand_id／environment／scopes 契約、每 App 限流及 401/403/409/429/5xx 錯誤語意，對接 AI-0 契約驗收。
- 管理跨系資料介面文檔與同意/同步契約；**不得**自行啟動雙品牌共用 Auth、D1、金流或用戶資料。
- 不擁有 AI-1 身分權威、AI-2 Billing 交易 D1、AI-3 Audit/Queue 稽核資料；各 Owner 仍負責其業務安全和寫入。
- AI-4 保留 Expo App、Worker 執行環境、CI/DevOps、EAS 上架。若決定增設 AI-5，交接 scope/分支/檔案/驗收範圍需先獲業主同意。

## 自動盤點與驗收
`node docs/api-handoff/verify-api-surface.mjs` 只讀 Repo 程式，核對 health 唯一路由、正式與候選 OpenAPI 分界、public SDK export 限制、P05 禁止發布、Starry/H-Global 隔離及 AI-5 **未啟動**。

測試 CI PASS = **API 現況記錄一致**，不是 API 功能上線。未來確實開通新 API 時，需先由 AI-0/Owner 完成安全 Gate 核准並更新 manifest 與檢查，不可以直接刪除測試通關。

未修改正式 D1／Cloudflare、Secrets、main、EAS Build/Update/Workflows；亦未批准或建立任何跨品牌 API。
