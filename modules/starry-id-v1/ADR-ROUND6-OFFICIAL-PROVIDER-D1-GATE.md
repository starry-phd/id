# AI-1 新架構第六輪：Provider 信任契約、Starry D1 Auth 權威與遷移回滾

- **Source of truth**：AI-0 第六輪暫行整合 Draft #57，固定 HEAD \`01ee5bb97988b9da493cd2c8a2727e84f73fbce0\`；Issue #2 [AI-0 第六輪實作指令](https://github.com/starry-phd/id/issues/2#issuecomment-6414111939)。所有新增檔案只在 \`modules/starry-id-v1/**\`。
- **狀態**：Draft/offline/security-only、OFF by default、無真實 OAuth HTTPS / Provider 官方簽發測試、Secrets、Worker 對外路由、正式 D1 或 EAS。**不能宣稱 Apple/Google 真實登入完成**。

## 新增可執行的服務端契約
1. \`src/round6-provider-authority.ts\`：Apple 固定 issuer \`https://appleid.apple.com\`、Authorize \`https://appleid.apple.com/auth/authorize\`、Token \`https://appleid.apple.com/auth/token\`、JWKS \`https://appleid.apple.com/auth/keys\`；Google 固定 issuer \`https://accounts.google.com\`、Authorize \`https://accounts.google.com/o/oauth2/v2/auth\`、Token \`https://oauth2.googleapis.com/token\`、JWKS \`https://www.googleapis.com/oauth2/v3/certs\`。只從後端 registry 讀取受信任 \`clientId\`、\`redirectUri\`、\`callbackOrigins\`，不從 HTTP JSON 組裝 arbitrary provider URL。返回的是伺服器純 metadata，**不會自動發起 OAuth**。預設禁用且限定 Starry development/staging；production 即使設 enabled:true 也拒絕。
2. JWKS 載入新增 \`TrustedJwksHttpAdapter\` 離線 evidence policy：請求與最後 URL 完全一致、HTTP 200、0 redirects、JSON Content-Type、回應長度 1～65536 bytes、耗時 0～5000ms、非空 JSON object，方交既有 \`createTrustedProviderJwksCache\` 做嚴格公開 RSA JWK kid/TTL/輪換與 \`verifySignedOidcIdToken\` 真 RS256。**這只驗 server-injected adapter 傳回的 metadata；真正 HTTPS/TLS 憑證／redirect/size/timeout 安全執行仍是 AI-4 尚未核准的責任，不能拿 Mock evidence 當官方網路證據。**
3. \`src/round6-auth-d1-authority.ts\`：以受控 Scope 包裝原 AI-1 \`createStarryD1Port\`；\`readAttempt\` 只讀 Starry D1 的 scoped OAuth state metadata，並從另一個 **server-only** \`SecureVerifierStore\` 讀取 secret PKCE verifier，從不持久化明文 verifier 到 D1；\`consumeAttemptCAS\` 對 app/provider/clientId/environment/state one-use。可以直接注入 #49 \`createOfflineStarryOidcCallbackGate\` 但不替代其真 JWT 簽名驗證。
4. \`readLinkedExistingMember\` 只從 \`starry_identities(provider,subject)\` join \`starry_members\` 為 active 的既有會員取 current auth_version；不憑 Email/姓名註冊或連結帳號。\`isCurrentSession\` 單 SQL join Session、Member、Identity，在每個請求的 server now 驗 App/env、auth_version、expiry、revoked status 和 stable subject。**這是額外守門，不是 \`TrustedPrincipal\`；AI-1 原 \`createServerIdentityResolver\` 的 WeakSet principal 仍必須重新核准**。
5. \`schema/006_starry_auth_guard.UP.DRAFT.sql\` 與 \`DOWN.DRAFT.sql\`：只建立/撤銷 index、無會員或交易 schema 的新增業務假設；真正 Python SQLite \`:memory:\` 前進、重覆執行、回滾、資料留存、錯 App/env/AuthVersion/suspended/revoked、CAS 重播、跨品牌負測。

## AI-4/AI-0 Gate
- AI-4 實際 Workers \`fetch\` 禁跟隨 redirect、檢查 HTTPS/TLS／回應來源、官方 Host、Header、Body 上限與逾時；令牌交換（Apple client_secret / Google OAuth secrets）和 callback URI、設備/原生 PKCE、CSRF/Cookie/rate limiting 必須有實際可信環境，不能用此 mock 作上線證據。
- 正式 Cloudflare D1 deployment、schema migrations、backups、rollback、併發 CAS/資料復原需 AI-0 另批准；OAuth secret store 物理方案由 AI-4 維護；此 PR 不運行遠端 D1、不讀真 Secret。
- G00～G10 11 個正式 Release Gate 仍 BLOCKED，P05 \`PUBLISHABLE=false\`；H-Global 完全獨立並暫停、Starry Battery 永久免費。
- DEV-I 2026-10-26 EAS Free 8 條：保留 GitHub 型別/Node/SQLite 安全 CI；不因 PR 自動 EAS Build/Update/Workflows。真正 Apple/Google 原生實機登入仍需 TestFlight/Google Play Internal 及官方網路 Gate；未經批准不得付費、部署、main merge。
