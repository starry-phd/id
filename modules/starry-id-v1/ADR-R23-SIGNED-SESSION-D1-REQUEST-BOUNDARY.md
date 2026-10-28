# AI-1 R23｜真簽章 Session → 當前 Auth D1 Principal 接線（安全離線驗收）

## 權威與位置
- 上游：最新 [AI-0 SBASE 五組 #164](https://github.com/starry-phd/id/pull/164) HEAD 11a0c9443ec34c60bcbcf77e1231e4b0f5381e04。#165 的額外一份 AI-0 Cloudflare Preview 事故證據保持獨立、未改寫。本輪仍按 #156／#1／#2 Starry 中央 Auth 唯一 Writer 規則與現有 R23 Release Gate；不重做 #160 AuthClient，不開發外部任何具名 App。
- GitHub Cloudflare Trigger 曾由 #164 branch push 嘗試 `npx wrangler preview` 並失敗，缺 `previews` 區塊。這是 AI-4 專責的新問題，AI-1 不更改 Worker/Cloudflare Trigger、Production、Repo visibility，也不 push #164 source branch。
- 現有真工程：`session-crypto.ts` WebCrypto HMAC 900 秒上限、`d1-ports.ts` 的 Member/Session/Stable provider D1 prepared SELECT、`index.ts` `createServerIdentityResolver` sealed Principal，各自已有獨立測試；缺的正是 HTTP Request Header 到以上三步的統一嚴格接線。本次只新增接線及實際 SQL 整合負測。

## 本輪新增實際程式，不造第二身份權威
`createOfflineStarryRequestAuthBoundary({enabled:true,serverScope,expectedOrigin,authDb,getVerificationKey}).authenticate(request,serverNow)`。serverScope 必須由可信 Server 配置決定、brand_id=starry、App ID 與 environment 只接受 development/staging；production 一律 constructor 拒絕。Origin 必須 HTTPS 且完全相符；只能 GET/POST 且只允許唯一格式 Bearer v1 簽章，拒絕 Cookie、proxy-authorization、X-forwarded-authorization、URL token、跨 App/環境與偽造 request。每個請求新建 Auth resolver：先真 WebCrypto HMAC Verify+key-id/時間/issuer-App scope，再以現有 D1 port 即時查 Member、Session、Apple/Google 不變 subject 唯一關聯與 auth_version，僅成功時回傳內部不可偽造 TrustedPrincipal（不是 HTTP JSON 或 token）；失敗、金鑰/D1 故障、停權、刪帳、撤銷、逾期皆 null。絕不新增 Session/JWT、網路路由、正式 DB writer、個資日誌或憑證。工作只在新安全 branch Draft。

## 可驗證的落地驗收
`test/r23-signed-session-d1-request-boundary.test.mjs` 使用 001 原始 Auth DRAFT SQLite 真表（Starry Members, Identities, Sessions），Node WebCrypto non-extractable ephemeral HMAC key 產生真正 server signed token；驗證原始 Member/Session/Provider 實讀、跨 App、跨品牌、Env、Cookie/Proxy header、Bearer 偽造、簽章遭竄改、Key outage、DB outage、停權/刪帳/撤權/版本升級及 readSelf WeakSet issuer 不可複製。任何查詢為 prepared SELECT，沒有正式 D1 使用。這會驗證「真正的密碼學和 SQL 接線」，但不代表真的連 Cloudflare D1 或建置正式 Worker。

## AI-4 & AI-0 下一步（Gate）
- AI-4：從此 module 取得 server-only AuthN port；僅在獲業主核准的獨立環境才可透過正式 Auth Worker 路由接入。必須有可信 env binding、real Cloudflare D1 migrations/bindings、受保護 key ring KID rotation/retire、host/origin policy、error masking、real OIDC Apple/Google provider JWKS/PKCE/state、refresh/token revocation 及失敗 audit，不能把既有 /v1/health 當 live Auth。
- AI-0：依 Release Gate 記錄 `code_exists` / `verified_offline` / `verified_live` / `blocked`。上述接線只可能是 code_exists+verified_offline。R23 Q104/Q119、#87 雙 D1 A/B、KMS/HMAC/P05 唯一證據、不可回退 witness、Store/Queue/Recovery、正式授權均仍 blocked。G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false。
- 任何 PR/CI 顯示成功都不代表真 Cloudflare Preview 或 Production 成功。禁止 main merge、真 Secrets、正式 D1、付費、Store、EAS、H-Global。原 18/18 SBASE blob 及既有 Auth 全部保持不變。回退只需撤除此 Draft 新的 Auth module/test/doc，舊 code 不受影響。
