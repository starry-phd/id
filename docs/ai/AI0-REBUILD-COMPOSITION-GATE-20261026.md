# AI-0｜新架構 Gate 1：四組程式同分支組裝與驗收

日期：2026-10-26。狀態：**新版本 Draft 整合候選，未合併、未部署，Gate 0/1 尚未完成**。

## 不可變來源 SHA
- AI-0 SSOT PR #25 `f9c02e2350fc1cf0311574ac05c3536d9b2900f5`（僅 25 條種子，coverage=seed_only）。
- AI-4 基座 PR #26 `6e8201fd6541d9bf081238356742df93ef564cf6`；本整合分支以其為父 commit。
- AI-1 Starry ID PR #27 `a5d73f13bd22910bbe2b118c2c063680dd387f0c`。
- AI-3 Audit PR #28 `00f9adfec18e44a59f77f8d78949940cc2f1741f`。
- AI-2 Billing PR #29 `c273a99e3bf2ea2bb2d8cd6da4904213d75dc291`。

## 本次整合範圍
將 AI-1/2/3 的 25 個獨立領域檔案（固定 blob SHA）匯入以 AI-4 為基準的隔離分支；加入同 checkout 的 Node22、locked npm、SSOT、TS、lint、Node policy、SQLite-in-memory、Expo 設定、Wrangler dry-run CI。**這僅驗證可共存與獨立模組同時過測，不證明各服務互相串通或可上線。**

## Gate 阻塞與合約差異
1. **Starry ID 必須實際接入**：目前 Worker 僅實作 `GET /v1/health`；AI-1 的 Auth/Profile OpenAPI 是 501 候選，沒有真正的 OIDC/JWKS/PKCE/Session/會員 D1 API。
2. AI-1 `TrustedPrincipal` 用 snake_case `s_user_id` 且 WeakSet 信任封裝；AI-2 `VerifiedStarryIdentity` 用 camelCase `userId`、`accountBinding`，目前缺**由 AI-1 唯一可信主體到 AI-2 的不可偽造受控轉接**，也缺過期、停權與撤權端到端測試。
3. AI-3 的 Audit metadata `event_type`／candidate version，AI-2 的 `billing.store_state_observed` Outbox，尚未共用 AI-0 正式 P05 event contract，也沒有可信隊列 adapter、可觀測的重試/補償。
4. SSOT `coverage=seed_only`：完整 108/130 項重整未完成；Battery 配額/錢包、IAP 自建/代管、D1/DO、Starry 旗艦 App 及最小管理操作清單尚未逐項核准，禁止把候選當已核准。
5. 會員服務各品牌**獨立**：Starry ID 會員主檔／Session／Auth 在 Starry；H-Global ID 保留獨立規格，嚴禁在 Starry repo 共用正式 D1/Secrets。
6. 真實 Store/Apple/Google OAuth、D1 並發、Queues 崩潰補償、EAS iOS/Android、Web 操作、Cloudflare Preview 或 Production 均未驗收。

## 下一步
- AI-0 建立完整功能 ID 盤點與 canonical principal/event API/資產權限契約。
- AI-1/4 實作測試用、真實不可偽造 server principal 到 Worker route 與 Session adapter。
- AI-2/3/4 完成原子 Billing outbox/inbox 事件契約與端對端離線故障測試。
- 統一變更從本隔離整合分支做 Draft PR，所有跨組更改只透過 AI-0 Gate；沒有用戶批准不 merge/deploy。
