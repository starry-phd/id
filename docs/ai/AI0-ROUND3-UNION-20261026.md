# AI-0｜第三輪完整合流驗收（2026-10-26）

> **此處為第三輪四組最新的隔離 Draft PR 候選驗收；不是正式 App、登入或購物功能上線證據。**

## 最新來源（固定 HEAD）

- 基線：AI-0 第二輪 PR #35，`c59c5dcdf97b8fdfb12b5bf76bfd8f85271febcd`。
- AI-1 PR #38，`942391ed7b8e9b4b4d2884573adfdecac02afcec`。 WebCrypto OIDC/PKCE、Session 加密、D1 Port；尚無真實 OAuth provider integration／Live D1。
- AI-2 PR #36，`c73ef26e1eb8a1a80991de8cfb788723c2afe670`。 Apple JWS crypto 與 Google authenticated RTDN/requery adapter；尚未正式驗證 Apple 官方 PKI chain、Google JWKS/Play production 網路或真實交易。
- AI-3 PR #39，`3f0e39a69f4e26ea79a49f6a7cc22f711f567130`。 Audit Queue inbox/atomic claim/durable quarantine、重試與 DLQ 安全邊界；尚無真正 Cloudflare Queue/ D1 實體綁定。
- AI-4 PR #37，`dc0b8cbc19c1f70fe722b70fe3caabec9a77110e`。 Protected Worker/member/SDK/Expo routing candidate；生產 Worker仍僅 health endpoint，會員頁/SDK 仍未開通。

## 整合機制
各 Owner 僅由已讀取的最新 SHA 原始 blob 構成，不帶舊 Round2 全 repo 歷史程式。所有新增加檔案經獨立新 workflow 同一 checkout 執行 locked dependencies、TypeScript、lint、最新 Node 正／負測試、SQLite in-memory、Expo config、Wrangler **dry-run**。完成後須檢查真實 GitHub run，不以 Owner PR 原有 CI PASS 當作本整合 Gate PASS。

## 仍待 Gate
1. `docs/requirements/registry.v0.json` 的 25 個 Seed 和 128 個來源標題尚未建立完整核准事項對照表，Gate0 **BLOCKED**。
2. 必須定案 **唯一** Auth／Session／Store binding adapters 與正式 Workers routes；真實 Apple/Google OAuth/PKCE 的 provider JWKS retrieval、主體版本吊銷以及合法前後端回呼流程仍未完成。
3. Billing Apple 官方 PKI trust validation/Google production JWKS與 Store verify/API、實際原子 D1 寫入和交易所有權責任仍未完成。
4. P05 `billing.p05.v1-candidate` 與 AI-3 `rebuild-p05.0.1-candidate` 及 Queue 格式尚無正式單一審定版；若來源非正式授權，不得 ACK、發事件或發放權益。
5. DEV-I 最新 Google Docs（2026-10-26）優先：EAS Free、每 PR 必須保留必要 CI 且不自動啟動 EAS Build；重要原生／付費安全測試仍需必要 Build，未經業主核准不得付費。本 CI 不使用 EAS 雲端 Build、不接真實 Sandbox、不啟用付費項目。

**正式裁決仍要以本 PR 最新固定 SHA 的 GitHub CI 與 AI-0 逐項安全 Gate 為準。無合併 main、無 Cloudflare 變更、無真 D1、無 Apple/Google 上架。**
