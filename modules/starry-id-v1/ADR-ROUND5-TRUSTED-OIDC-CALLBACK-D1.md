# AI-1 第五輪：預設關閉 OIDC callback＋D1 migration/rollback（工程候選）
狀態：**Draft / Offline Only / Never Enabled Live**。依 AI-0 最新 Issue #2 第五輪指示與第四輪整合 Draft #46 固定 SHA \`bacc0166bf4e1070a4696c7bc109197b4c642f9f\`。

## 已實作的可離線執行控制
- \`createOfflineStarryOidcCallbackGate()\`：未提供 \`enabled:true\` 一律回傳 null；即使啟用離線候選，只有 Starry development/staging server-owned scope 可使用，production/foreign-brand 拒絕。回呼僅接受兩個 data-only 欄位 \`state\`、\`code\`（不容任意 client claims/getters），provider/clientId 一律由後端釘死。
- 讀取可信的 Server State（nonce、PKCE S256 verifier/challenge、app_id、environment、clientId、expiry），原子 \`consumeAttemptCAS\` **只接受一次**並先於後端注入 \`exchangeCode\`；失敗不得重用 state。無任何直接 OAuth HTTP／JWKS 網路存取，且不產生認證 Session。
- 從 OAuth Exchange 回來的 ID Token header **只提取 kid 選取金鑰**，不得視為可信身分；使用上一輪 \`createTrustedProviderJwksCache\` 的 Apple/Google 官方固定端點、未知 kid throttle/rotation，再使用 \`verifySignedOidcIdToken\` 真 RS256 WebCrypto 驗 issuer/audience/nonce/時效/穩定 sub。
- \`readLinkedExistingMember\` 僅接受 Server Starry ID DB 內既有的穩定 (provider, sub)→\`s_user_id\`、ACTIVE/auth_version；suspended/deleted、跨 App、版本不合不可通過；結果 \`isServerVerifiedExistingMember\` 使用 WeakSet 做 runtime seal，**不等於** \`TrustedPrincipal\`／DB Session 成功。Session 寫入仍須現存 \`createStarrySessionPersistence().createForExistingMember()\` 再次由 D1 單 SQL 檢查 member ACTIVE+provider+auth_version；沒有真 D1 時不得發憑據。
- \`createStarryServerSessionKeyring\` 由 Worker server-only CryptoKey 建立 active kid/退役驗簽期限政策；簽入期限與核驗期限明確分開，逾期 fail-closed。**真 Secret 分發、輪換回滾操作未執行**。
- \`schema/005_starry_oidc_indexes.UP.DRAFT.sql\` 與 \`DOWN.DRAFT.sql\` 為索引增補／撤回的**實際 SQLite 可執行**草稿，向前與回滾均冪等且保留會員/Session/原 OAuth Attempt；僅在 Python SQLite \`:memory:\` 記憶體執行。

## 邊界與 Gate
- 正式 Apple/Google OAuth 對外 TLS/JWKS HTTP/官方端點信任、正式 clientId/callback scheme、密鑰/Secret/PKCE verifier 儲存、D1 migration/rollback backup/多 Worker 原子競爭、App/SDK 實機登入、Session cookie/CSRF/Rate-limit 尚未做。AI-4 owns Worker/API/Expo 接線；AI-0 must explicitly approve provider trust/config, physical DB and deployment.
- AI-1 仍擁有 Starry \`s_user_id\`、會員資料/Session/Identity/StoreBinding 權威，AI-2/AI-3 不得自行將 HTTP JSON/付款/事件資料聲稱受信身分。H-Global 有獨立 Auth/D1，這裡不實作。
- DEV-I Google Doc EAS Free 最終 8 條：PR 要保留必要 CI，不自動觸發 EAS Build；未來必要 iOS/Android 原生登入真機驗收不得省；無付費、無 Cloudflare D1/Workers、無 Provider HTTP、無 Secrets、無 main merge/Production/Staging/Preview deploy。
