# AI-4｜第三輪 Workers／Starry ID／SDK／Expo 組裝交接
- 基底：AI-0 第二輪整合 Draft PR #35 `c59c5dcdf97b8fdfb12b5bf76bfd8f85271febcd`（不是 main）。
- Owner 範圍：只新增／修改 `apps/**`、`packages/sdk/**`、AI-4 專用 CI 與文件；不修改 AI-1 的 `modules/starry-id-v1/**`、AI-2 `packages/rebuild-billing/**`、AI-3 `packages/rebuild-ai3/**` 或 AI-0 SSOT。
- `apps/api/src/member-contract.ts` 使用 AI-1 原生 `createServerIdentityResolver` + `readSelf` 串接可信驗證介面、當前有效會員／Session、最小個人檔案投影；含錯品牌/App/env、過期／吊銷／停權、未簽 token、伪造 body/query/header 的負向測試。**僅工廠、未在正式 Worker 實例化**。
- `packages/sdk/src/member-preview.ts` 提供唯讀驗證用型別與 fail-closed HTTPS bearer 介面，但**沒有從正式 SDK index 輸出**；測試串接 Worker 契約。
- `apps/mobile/src/member-service.ts`、Expo `/member/profile` 明示「未啟用」，不可使用本地假資料或固定 Session；測試確認不會發起會員網路請求。
- `apps/api/openapi.member.DRAFT.yaml` 明確標示候選，不修改已服務 `apps/api/openapi.yaml`（僅 /v1/health）。
- AI-1 #33 `createStarryBillingAuthPortForRequest` 與 AI-2 最新契約、AI-3 canonical P05 候選仍由專責 AI/AI-0 協調；AI-4 的 GitHub 整合 CI 在**同一 commit**驗證 AI-1/2/3 全部 Node/SQLite + 最新跨模組負測試，避免把舊版本當最新。
- 故障復原/Queues、真 Apple/Google OIDC+JWKS+PKCE、真正 D1 Session/Store Sandbox、原生 EAS、Cloudflare Preview/Production 均**尚未實作/驗收**。
- AI-0 Gate0 SSOT 25 seed 未完成；需權威真實驗證器及資料服務後，才可明確批准將 `member-contract` 接到入口、正式 OpenAPI、SDK 與 Expo 登入。
