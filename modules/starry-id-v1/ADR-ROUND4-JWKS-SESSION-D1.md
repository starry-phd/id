# AI-1 新架構第四輪｜Starry ID JWKS、Session 與 D1 安全持久化
**基準**：AI-0 [Draft PR #40](https://github.com/starry-phd/id/pull/40) SHA \`6d7c54e8c8eecdde810a83932ac9f6bc6fee53fd\`、Issue #2 最新第四輪指令、DEV-I Google 文件 2026-10-26 最終 EAS Free 規則。全部 **offline candidate**；SSOT Gate 0、真實服務 Gate 1 仍 BLOCKED。

## 可執行成果（安全、領域專責）
1. \`src/jwks-cache.ts\`：固定 Apple 和 Google 官方 JWKS URL，絕不採 JWT/HTTP 傳入網址；RSA ≥2048 位公開金鑰、唯一 kid、拒絕 private JWK、key_ops 非 verify、HTTP 失敗/錯 JSON、重複 kid；TTL 限制 60～3600s、未知 kid 最快 30s 才再查以防遠端放大；進行中同來源請求合併；cache 過期時拒絕舊 key，安全失敗預設拒絕。回傳的 JWKS 仍需由 \`verifySignedOidcIdToken()\` 完整 RS256 及 issuer/aud/nonce/timing 驗證。輸入 \`TrustedJwksTransport\` 是 AI-4/Cloudflare 真正 HTTPS transport **尚未實作**（TLS、no redirects、timeout/size cap、金鑰輪換、真 Apple/Google 網路仍未驗收）。
2. \`src/session-persistence.ts\`：Starry ID **既有** ACTIVE 會員、Apple/Google 不變 Provider subject 綁定的 D1 \`INSERT ... SELECT\` 單一 statement，拒絕擅自依 email 建帳；只儲存 256bit+隨機 refresh secret 的 SHA-256 hash，嚴格 store/runtime/App/時效；refresh 輪轉與 member auth_version 提升使用 SQL CAS + exactly-one changed row。授權變更由 \`createServerIdentityResolver\` 每 request 查最新 Member/Session；已簽名 JWT/HMAC 單獨不足以授權。這些是可信 server port，AI-4 只注入真 Cloudflare D1 綁定，絕不可用 client fields 呼叫。
3. \`src/cookie-safety.ts\`：\`__Host-\` Secure、HttpOnly、Path=/、SameSite Strict 短期 Session cookie 和撤銷 header，敏感 Cookie mutation 要求固定 HTTPS Origin/同站 Fetch Metadata + server-backed CSRF 驗證；原生 bearer flow 必須另有安全機制，不能複用 cookie bypass。
4. SQLite-memory 將新 D1 SQL 真正在 SQLite 執行，驗證 provider association、唯一 refresh token/hash、跨 App/環境與 CAS、撤權、重播；Node 端測具體 JWKS 刷新、Fake/Expired/Unknown kid、Session 與 Cookie/CSRF 保護。

## 外部 Gate 與 AI-4 交接
- AI-4 提供伺服器固定 issuer / clientId / callback URI 、HTTPS JWK transport（拒絕重新導向，強制 Content-Type/大小/回應時間）、OAuth authorization-code exchange、一次性 state 與安全 PKCE verifier storage、Cookie/CSRF 與 Rate-limit，Cloudflare Worker D1 binding，隱密 key/Refresh 的真正 entropy/輪轉。**不在本 AI-1 PR 內觸網或碰真 Secrets/D1**。
- 真實新增會員流程、舊資料移轉、帳號合併、停權刪除跨域事件、管理員角色、隱私搜尋與 break-glass 需 AI-0 明確 Gate，不擅自新增業務規則。
- DEV-I 成本規則：每 PR 需 TS/Node/SQLite CI；無自動 EAS 雲端 Build、EAS Update、EAS Workflows、不升級付費；未來 Apple/Google 原生登入一定要 TestFlight／Google Play 內測與實機驗收，不能以離線測試代替。
- Starry 專責、H-Global ID 完全獨立，無雙品牌共用會員 D1；這份只有 AI-1 own files。仍維持 Draft、無 merge main、無部署、無真 D1、真 Apple/Google 憑據、真金流。
