# AI-2 → AI-0 / AI-1 / AI-3 / AI-4｜Gate 1 Trusted Billing P05／Inbox 交接 v0.2

**日期：2026-10-26；純 Offline Sandbox / DRAFT / NOT DEPLOYED。** 來源：AI-0 2026-10-26 第二輪 Issue #3、AI-0 composition Draft #30 `a74f9495c807e77d5fc3dde73f9cc79fb6002e89`、AI-1 Draft #27、AI-3 Draft #28、第一輪 Billing Draft #29。此新 PR 是疊加 #30 的候選，沒有合併 main，也沒有批准支付供應商。

## A. 唯一可信身份與付款綁定
- **權威主體必須由 AI-1 `createServerIdentityResolver` 實際發行**。AI-2 `planSandboxPurchase()` 現在直接 import AI-1 `isTrustedPrincipal()`，使用 AI-1 WeakSet 模組真實執行時校驗。舊的 `VerifiedStarryIdentity` 公開 DTO、`verifyCurrentIdentity()` 旗標入口已刪除；單靠 HTTP JSON、擬態物件、相同欄位、假 JWT、`adminVerified` 不能建立權威。拒絕非 Starry、錯 App、Worker 環境、非 active、過期、或不是同一秒重新驗證發行的跨請求 principal。
- Starry `s_user_id` 的唯一 owner 是 **AI-1**；Billing projection 的 `userId` 只取 `principal.s_user_id`。`accountBindingFor(sUserId, registry)` 是 AI-1/AI-2 信任域內、從 Server 資料表查得的 provider account binding 介面；**不得用 client、Email、姓名、或單純 `s_user_id` 字串取代 provider-attested binding**。真正 Apple `appAccountToken`、Google `obfuscatedAccountId` 比對依賴 AI-4 商店驗證 adapter 尚未建置，這些 mock 不證明真購買。
- `opaqueActorRefFor(sUserId, registry)` 須使用**後端管理、帶金鑰或隨機不可逆 pseudonym 映射**。不准把 `s_user_id`、accountBinding、電子郵件、原始交易憑證直接放入 Audit event；目前 runtime 只驗輸出的安全識別符字元規則及它不同於 `s_user_id`/accountBinding，尚未實作真實假名化發行與輪換機制。Server port 不可從 request data 建構，也不能把測試的 mock Auth port 用在部署。
- `serverNow` 必須由 Worker 時鐘取得，不接受 HTTP。一次 request 只能重新建立一次已驗證 principal；後端查當前 Session/Member/Grant 仍是 AI-1 責任。最終端對端驗證需要真 JWT/OIDC/JWKS、持久 Session 及刪帳/撤權跨 Workers 並發測試。

## B. AI-2 Billing P05 Candidate（AI-0 尚未核准 canonical）
新 `Plan.p05` 只有 13 個 allowlist keys：

```text
brand_id=starry; app_id=<trusted registry>; environment=development|staging
schema_version=billing.p05.v1-candidate
event_id=b_<SHA256>; event_type=billing.store_state_observed
occurred_at=<server-verified provider event RFC3339>
correlation_id=b_<SHA256>; idempotency_key=b_<SHA256>
actor_ref=<server-issued pseudonymous reference>
resource_ref=b_<SHA256>; result=recorded; classification=metadata_only
```

`storeEnvironment=sandbox` 是 Billing provider 域獨立軸，不能塞進 AI-0 未批准的通用 Envelope。此候選無 raw JWS/購買 Token/付款卡號/帳戶識別/個人資料；同可信 provider 事件重送可保持 key 穩定，對不同 store/app/runtime/transaction 分流。

**已經在真實 AI-3 #28 契約上測出阻塞**：
- AI-3 `AuditMetadata.schema_version` 僅允許 `rebuild-ai3.0.1-candidate`，而非 `billing.p05.v1-candidate`。
- AI-3 `EVENT_KINDS` 尚未包含 `billing.store_state_observed`。
- AI-3 `isAuditMetadata(plan.p05)` 會回傳 **false**，SQLite `ai3_audit_metadata` 版本 CHECK 會拒絕本 Billing candidate。這是**正確的 fail closed**，不是已完成串接；AI-0 需定共用 P05 版本與事件 allowlist，再由 **AI-3** 修改自身契約，AI-4 才能接 Worker/Queue。AI-2 不修改 AI-3 或 AI-0 專屬程式。

## C. 原子性、去重與恢復順序
1. 後端驗證 APP/Store/Starry ID 綁定，然後產生 `b_` + hex SHA256 穩定鍵與 payload digest（不取 client 偽造 key）。同 key + 相同 digest 是 duplicate / no effect；同 key + 不同 digest 要 quarantine/拒絕，不可偷偷覆寫。
2. **同一 Billing 實體 D1 transaction**：原始交易唯一 owner claim、provider-event insert、entitlement 版本 CAS、Billing outbox insert **全部成功才 commit**；任一失敗整筆 rollback。不可讓 Apple/Google 外部網路呼叫包含在 D1 交易中。D1 真實原子及高併發仍未實作；跨不同實體 D1 不假定有原子交易。
3. Billing commit 後，由 AI-4 Queue adapter **至少一次**傳 AI-3；**AI-3 Inbox** 在自家邏輯 domain 依 `(brand_id,app_id,environment,idempotency_key)` 去重，驗證同 key payload digest、scope、canonical schema；AI-3 inbox claim 和其 audit append 要按自身持久交易一致性完成，不能只有「claim 成功」卻遺失 audit。真正重試/Dead-letter/補償/保留策略尚待 AI-3、AI-0 Gate。
4. 補測使用**單一記憶體 SQLite** 同時載入 AI-2/AI-3 **原始未變** SQL，展示 inbox UNIQUE、錯品牌/env、錯 schema 版本、失敗 rollback、舊期間退款無法以 CAS 覆蓋新期間續訂。這不代表兩份遠端 D1/Queue 可保證 exactly-once，也不代表商店驗簽實作完成。

## D. 測試與否定案例
- TypeScript strict、Node 22 含 AI-1 **真正 WeakSet resolver** 的 test-only simulated backend / AI-3 真實 validator，以及 SQLite in-memory 兩組原始 schema。真 crypto/mock 標示分清。
- 新增：client 結構仿冒／序列化主體、會員 suspended/deleted、Session revoked、stable provider link 錯、跨請求 Principal 重放（**晚一秒即拒絕**）、跨 App/env/store、錯 user/交易 owner、actor 個資/來源、錯 schema version、inbox duplicate/品牌/環境，historical refund 權益不復活、不錯撤銷新續訂。
- CI 以此 PR **最終 commit HEAD 的 GitHub run** 為準；原 #29 TypeScript 19/19 + SQLite 9/9 是上輪證據，不代表本輪修復。全部只是離線安全契約，非真實 Auth/Store/D1 end-to-end。

## E. 各 Owner 接手
- **AI-0 #1**：正式 P05 canonical event `event_type/schema_version`、錯版拒絕策略、Billing 實體 D1 與 Audit inbox 的物理一致性、SSOT 108/130 功能盤點、IAP A/B 及退款/Grace 策略。Gate 0、Gate 1 仍 **BLOCKED**。
- **AI-1 #2**：Worker/服務只交同請求 AI-1 WeakSet principal；server-only owner accountBinding lookup/actor pseudonym，真身份/Session 撤權；先核准接口權責，不將假 principal 變 live。
- **AI-3 #4**：在 AI-0 正式版本決議後支援 `billing.store_state_observed` 之 P05 receiver/inbox/idempotency digest、quarantine/retention、重試及 audit 錯版；不得改 Battery 永久免費政策。
- **AI-4 #5**：固定此 PR SHA 進獨立整合 Draft，嚴格 root CI、Worker Auth protected route 僅 server-verified，true Apple/Google verification 後再實作 Billing D1；現階段只能 `/v1/health` 為已實作路由，不能部署或運行實際付款。

**無 Production、正式 D1、Secrets、真金流、H-Global 實作、Cloudflare 部署或 main merge。**
