# AI-2｜第四輪 D1 原子交易／After-Commit Outbox｜Gate 候選

日期：2026-10-26。基準：[AI-0 第三輪整合 Draft #40](https://github.com/starry-phd/id/pull/40)，固定 SHA `6d7c54e8c8eecdde810a83932ac9f6bc6fee53fd`。**此為離線開發與 Draft SQL／TypeScript；所有新版程式都沒有部署，沒有遠端 D1 操作。**

## 已實作

1. **既有 Apple/Google Store Sandbox 驗證仍保留**：AI-2 第三輪 WebCrypto Apple ES256 JWS 與 Google RSA JWT + Play API back-end re-query 的模組，但 Apple 官方 x5c PKI trust 及 Google 公開 JWKS／真 Google Developer API 網路仍是可信 Port 待建，不得把生成測試金鑰或 mock verifier 當作官方支付憑證。
2. `planSandboxPurchase` 的新事件 Plan 由本模組 WeakSet **封印為不可被 JSON／結構相同物件偽造的計畫物件**，其 snapshot/entitlement/outbox/P05 均 `Object.freeze`。原 AI-1 `isTrustedPrincipal` 每請求驗權、伺服器 Store account binding 比對不變。**此封印僅證明進入了 Billing planner，不能單獨證明外部 Store provider 信任鏈為真**；正式 Worker 必須先接已驗真商店且 server-only 的 StorePort。
3. `src/billing-d1.ts` `createSandboxBillingD1Writer` 僅允許 `starry` Worker `development|staging` 與 Store `sandbox`；使用不可匯出的伺服器 HMAC CryptoKey 產生 owner_key、binding_digest、交易/provider 消敏參照，不把 raw receipt/token／原始交易 ID 放入 SQL 欄位。生成 **固定準備好的 SQL 字串與參數**，不拼接 client SQL。
4. 同一個 Billing D1 邏輯 writer 的 5 個 `batch()` statement：**首次 owner claim → provider verified event → entitlement CAS → 安全 P05 outbox → receipt CHECK guard**。最後一步檢查 entitlement 有沒有以預期 row version 更新，並檢查 Event digest 與 Outbox；任何失敗的 SQL 約束會使整個 D1 batch 回滾。SQLite 已用 TypeScript 原始 SQL 字串實際測試，不只是照規格重寫 mock SQL。
5. `readAfterCommit(eventRef)` **從 Billing D1 四表 JOIN 讀取**被 guard 標記、Provider verified 的已提交事件，僅允許合法 Scope、P05 candidate version、固定鍵和 digest；不得以 HTTP JSON 的 `committed:true` 或 `verified:true` 取得此讀取權。交 AI-3 `BillingCommittedReader.readAfterCommit` 的結果形狀：`{p05,payload_digest,committed:true,provider_verified:true}`。
6. 已存在事件相同鍵／相同 digest／相同 owner 可辨識 duplicate；同鍵不同 digest 或其他 owner 必須拒絕。CAS 與交易唯一性以 DB 實際 SQL 防護；不先 ACK Queue 或預先授權付款權益。**歷史／未變動事件的原子 audit-only 入庫尚待 AI-0 政策決議**：新 writer 保守拒絕，絕不把舊退款覆蓋更新的權益。

## 已驗證／尚未驗證區分

- `test/billing-d1.test.mjs`：實際匯入 AI-1 發行的 WeakSet 主體經既有 Billing planner 走到封印 Plan；D1-shaped prepared/batch stub 正／負測含 HMAC 不洩敏、拒 client 物件、錯 scope、CAS stale、failed batch、same-key replay、after-commit DB row proof。
- `test/test_round4_atomic.py`：直接擷取 `billing-d1.ts` 的 SQL string arrays，用 sqlite3 `:memory:` 執行初始 SQL 與 **未套用** migration `0004_billing_atomic_DRAFT.sql`；驗證首次五段成功、Outbox 錯版整批回滾、CAS 競態檢查防止 partial entitlement、首次購買 owner 劫持、event duplicate/conflict、免費 Battery 禁購、無完整交易時 receipt 不可生成。
- **不能因此宣稱真 D1/Workers 多併發已通過**：未以遠端 D1 或 Cloudflare D1 emulator 進行 read-replica/stale-read、鎖競爭、超時、重試/backoff、session bookmark 驗證；單一 Runtime／實體 D1 放置、HMAC Key 輪換、帳單合法保留／補償、真正 Apple PKI/Google 公鑰與 Provider Store API 全需 AI-0/AI-1/AI-4 另行核准。
- `billing.p05.v1-candidate` 13 欄只能透過 AI-0 唯一 canonical gate 與 AI-3 同步定版後投遞。AI-3 的持久 Inbox／Audit／Queue／DLQ **不屬 AI-2 寫入領域**，本輪未改動 AI-3 程式，無真 Queue ACK。

## DEV-I 最新八項 Expo／EAS 成本規則

已直接讀取 [DEV-I 最新 Google Docs](https://docs.google.com/document/d/1dsMcGBT5PO43aQVMhZOBO5uyNTE8QHYSnBmC4y2rMSI/edit)：2026-10-26 最終規則為 Expo/EAS 優先 **Free**，每 PR 跑必要 TypeScript/Lint/Node／契約/安全／SQLite CI，不為每 PR 自動啟動 EAS Build；Build、Update、Workflows 分開計量，必要的原生登入／IAP／推播 Build＋實機 TestFlight／Google Play Internal 仍不得省略，所有帳單估算不可冒充實際費用。無業主事前同意不升級、不消耗有超額費用的額度、不部署。本輪 **沒有 EAS Build、EAS Update、EAS Workflow、雲端原生付費或金流 Sandbox 真交易**。

## 下一輪依賴

- AI-0 #1／#40：完整 SSOT 核准、唯一 P05/actor 權威、D1 物理配置、SKU／Grace／chargeback／Store 自建或代管、舊期 audit-only 政策。
- AI-1 #2：Starry ID 真 OIDC/Session/Auth Revocation、持久 Store account binding、backend pseudonym。
- AI-3 #4：Canonical P05 對接已提交 Billing Outbox，AI-3 自家 D1 原子 Inbox/Audit 與 Queue retry/DLQ／重播風險測試；不可從客戶端接 `provider_verified:true`。
- AI-4 #5：Worker 僅在 AI-0 Gate 批准後綁真 Apple PKI trust、Google JWT 官方 JWKS 與 Play API、Cloudflare D1、受保護 API 與 EAS 真原生驗收。
- **Starry Battery 永久免費**，H-Global 仍是獨立生態系，沒有其 PAYUNi／會員資源；無 Production/Staging 部署、正式 D1、Secrets、main merge 或付費工具。

所有交付維持獨立 Draft PR＋最新固定 SHA＋GitHub CI 證據，不是上線聲明。
