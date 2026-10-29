# AI-1 W1｜Auth/Session/current-member 可實作契約與 #244/#245 原始碼審閱（非 Live）

**正式工作令**：[Issue #2 #6479254701](https://github.com/starry-phd/id/issues/2#issuecomment-6479254701)。基準 AI-0 [#242](https://github.com/starry-phd/id/pull/242) exact `22d7ab1c127546e9e131810d58fdf7e0ccb17882`。本 AI-1 新增路徑，不改既有任何 Owner / Worker / SDK / shared OpenAPI；後續由 AI-0 整合。

## 1. 已核准方向（不再重選）
- [D00](https://github.com/starry-phd/id/issues/1#issuecomment-6479057455)：中央會員、Auth、Session、權限優先，其他已准中央模組保留；G00 仍 BLOCKED。
- [D87](https://github.com/starry-phd/id/issues/1#issuecomment-6478861308)：**單一交易權威方向 A**，不等於全部資料在同一實體 D1、也不表示真交易/多資料庫 ACID 已驗證。
- [D06](https://github.com/starry-phd/id/issues/1#issuecomment-6478960617)：**11 欄業務／稽核核心＋條件 idempotency；獨立私密安全封套**。G06 曾述「13 欄」未列權威；R006 17 欄只屬離線候選，不能從 11+1 猜第 13 欄或偷偷提升為正式 schema。
- G00–G10 11/11 BLOCKED、P05/PUBLISHABLE=false、release_authorization=false。這份契約只做 W1 code-review／安全欄位名稱防洩漏審查，非正式 P05 校驗器。

## 2. 真正逐檔 Review #244/#245，不重寫 read path
審查的隔離來源：[#244](https://github.com/starry-phd/id/pull/244) SHA `7965ee9a9b0a80bc595b207382aac75bf7a33548`、server blob `3acd105e0942514cbc24dd8032c3166b484bb5c2`；
[#245](https://github.com/starry-phd/id/pull/245) SHA `e1b255b014c673439f134ef5a58107a036f4b60f`、client blob `f60b4063277b36c180fcece85a47db0482eda641`、standalone OpenAPI blob `638d242f3b799a894f8a3587ee3ca48737236cee`。[同 SHA Full Offline CI #40823124420](https://github.com/starry-phd/id/actions/runs/40823124420) 1,838 Node＋413 SQLite memory PASS（由 AI-0 驗收；不是本 W1 分支 CI）。

**已確認的具體程式行為：**
1. #244 `createIsolatedSelfProfileHandler` 預設 OFF、僅 Starry development/staging；`GET /v1/starry-id/members/me` 且 origin 必須匹配，禁止 caller 指定 member、query、Cookie；初始 `createOfflineStarryRequestAuthBoundary` 用真 HMAC bearer＋DB Member/Session/Provider current read，**非客戶端 loggedIn**。
2. 額外 `createVerifiedSignedSession` 重驗取回 signed provider/subject；最後單 SQL `JOIN starry_members m JOIN starry_sessions s ... EXISTS(starry_identities provider/subject)` 在同一 read snapshot 再驗 active/member current auth_version、Session app/env/未 revoked/未過期、provider binding；拒絕驗證等待期間撤權、刪帳、解綁、版本漂移。請務必保留該 **final SELECT fence**。回應只有 **五欄**：`s_user_id, display_name, directory_opt_in, display_name_public, profile_revision`，revision 必須安全整數 >=1；沒有第六欄，#244 舊 prose 已由 #245 修正。永不 spread DB 私密欄。
3. #245 獨立 client 顯式注入 `getBearer/fetchImpl`，無 ambient fetch；HTTPS origin、GET、`credentials:omit`、redirect error、`cache:no-store`；必需 JSON/no-store、精確五欄，16KiB 有界回應、拒絕加料 PII／錯版／不安全型別。OpenAPI 為 **standalone** `servers: []`、worker_registered=false；不能把成功離線測試當目前 Worker 已註冊。
4. 註冊 Worker 的 `apps/api/src/index.ts` 目前只有 GET `/v1/health`。**不要再製作本人的 read handler / client / OpenAPI 副本**，AI-4 才是 shared route/SDK/OpenAPI 唯一編輯者，需審 AI-0 已做內容並另提接線 PR。

**待 AI-0／AI-4 協調的具體安全差異（未在原檔偷改）：**
- 兩段 DB read **不等於跨時刻的單一 snapshot**；最終單 SELECT 擋住 read 前變更，**SELECT 結束後**仍可撤權，回傳只能視作該時點查詢結果，不准拿結果授權後續 write、Billing、Queue ACK。
- `createOfflineStarryRequestAuthBoundary.authenticate` 例外（key outage、DB unavailable）回 `null`，#244 會轉 **401 IDENTITY_DENIED**；最終 SELECT 的 DB 例外變 **503 SERVICE_UNAVAILABLE**，最終查無 active/provider 變 **403 CURRENT_RECORD_DENIED**。#245 client 對 401→`AUTH_REQUIRED`，403→`CURRENT_RECORD_DENIED`，503→`SERVICE_UNAVAILABLE`；此「初期依賴故障也當401」是**明確 retry/可觀測性／不洩漏內部故障**需審的政策缺口，不可擅改共享 API 的 wire error 或讓 client 對401自動無限制重登。
- `GET` 只允許 server-owned current scope，絕不可因 `s_user_id` query/body、client-supplied `verified:true`、任意 app/brand/env header/Host 放寬；正式 private token custody、HMAC key/KID rotation、官方 OIDC/JWKS、Auth D1/Worker binding 均未授權；production must fail closed。
- `/v1/member/self` 舊 AI-4 draft **不得無條件別名**；此切片 canonical `/v1/starry-id/members/me`，profile_revision>=1。AI-4 統一 shared OpenAPI 先必須核對兩份歷史契約而非同時啟用兩個端點。
- `POST`、`PATCH`、`DELETE` 目前**沒有本 #244 read-only slice 的權限**。須由 AI-1/AI-4 按 D87 Auth 唯一 writer 與欄位政策另審，避免由 client/通用 Worker 寫入。

## 3. AI-1 唯一 writer 與 D87 交易邊界（可編碼草案，不是物理 schema 批准）
| 操作 | 唯一寫入者／原子邊界提案 | 既有 source / 缺件 |
|---|---|---|
| Apple/Google stable (provider,sub)→s_user_id first claim/註冊 | AI-1 **Auth identity 權威**；標準化 subject 唯一限制＋建立 member/binding 在**核准的同個物理交易**；CONFLICT/replay 不可 fallback email 合併 | `src/round6-auth-d1-authority.ts`、`src/round5-oidc-gate.ts`／真 issuer callback＋受控 Auth transaction 尚缺 |
| Session 建立、refresh one-use CAS、登出／全登出 | AI-1 Auth Session writer；同權威驗 `member.status, auth_version, app,env, provider`；refresh 需要 `refresh_hash` exact CAS、唯一 changes==1；撤銷提升版本並禁止新 token 出現 | `src/session-persistence.ts` `rotateRefreshCAS`、`bumpMemberVersionCAS`；後者**單 UPDATE 不等於**「全 session revoke＋outbox」的同一 transaction |
| 本人 profile update（後續，不在 #244 read） | AI-1 Member writer；`UPDATE starry_members WHERE s_user_id=trusted AND active AND auth_version=current AND profile_revision=expected`、`changes=1`，revision+1 | `src/index.ts:planSelfUpdate` + `src/d1-ports.ts:updateProfileCAS` 已有離線 adapter；**禁止另一個 Worker writer** |
| 暫停／復權／刪帳／step-up | AI-1 Auth writer；P04 受保護 step-up、撤權版本/Session fence 與 provenance 同一核准權威提交，對外稽核待批准 envelope/outbox | `src/index.ts:requireMemberAdmin/planSelfDeletion` 與 round10–20 撤權/復原契約；**Q104/Q119 retention/legal hold/PITR witness 未核准** |
| 本人資料 GET | 無 writer。AI-1 現有 read authority 由 #244 真 HMAC+SQLite SQL/current session fence，**不是可用作任意 write 的 principal** | #244/#245 已有 isolated implementation，AI-4 shared接線未做 |
| 跨模組 Billing／Battery／Audit | AI-2／AI-3 負責各自 domain；不得修改 Auth member/Session，D87 單一交易權威具體聚合欄位及 commit/outbox 要 AI-0 審核 | AI-1 不自行批准全系同庫、分散式 ACID 或外部 Queue ACK |

**原子性重要限制：** 單 SQL update 成功 != 將事件入 durable outbox／撤銷所有 Session／跨服務 ACK 都提交成功。物理 D1 拓樸、同一 commit 的表集合、失敗後補償／Anti-PITR witness 和 schema migration 必須由 AI-0 +各 writer 確認後才能啟用；此處不執行任何 D1 migration。

## 4. AI-4 shared 路徑／DTO／errors／scopes 精確差異表
| operation | request／回應 | 授權／錯誤／現況 |
|---|---|---|
| `GET /v1/starry-id/members/me` | `Authorization: Bearer <server-signed session>`，`Accept: application/json`，no query/body/cookie；200 JSON **五欄**、`Cache-Control:no-store` | self:read（**候選 scope**，非已批准存儲 grant）；現有 isolation #244/#245；400 REQUEST_DENIED、401 IDENTITY_DENIED、403 CURRENT_RECORD_DENIED、404 NOT_FOUND、405 METHOD_NOT_ALLOWED + Allow GET、503 FEATURE_DISABLED/SERVICE_UNAVAILABLE。403 不可當 refresh token 可修復 |
| `PATCH /v1/starry-id/members/me` | 候選 body 只能 `display_name?,directory_opt_in?,display_name_public?` + **required** `expected_profile_revision`（建議作 conditional request／前置欄，需AI0/AI4決定，不能自行發布）；回傳 final revision | self:write 候選；Server Auth current+CAS，409 `PROFILE_VERSION_CONFLICT` 候選；目前無可呼叫實作，不得把 `planSelfUpdate` 直接暴露 HTTP |
| `GET/DELETE /v1/starry-id/session` | read Session 指標僅最小化，DELETE 建議 current-session revoke＋AuthVersion CAS，回應不可包含 refresh secret | session:read/revoke 候選；真 issuer/rollback/同權威 commit 尚未完成，正式 HTTP 仍 501 draft |
| `POST /v1/starry-id/auth/exchange` | server-only provider metadata、PKCE/state/nonce consume、provider-subject first claim；禁止取 client-supplied identity | auth:exchange 候選；真 provider 官方 TLS/key/callback 尚缺，正式 501 draft |
| Admin 受保護停權／復權／刪帳 | server-side P04 grant/step-up/scope/action、brand/app/env/target recheck，過期/跨環境 default deny | `member:suspend` / `member:restore` 已為已有域內 type；更高權限/刪除流程需正式法遵/AI0 裁決，不能自訂「超級管理員」 |

**不能把候選 scopes/errors 視為已有 SDK/Worker 或 owner-approved contract**。P01 App/Brand/Env 由 AI-4 registry/AI-0 最終裁決，P02 shared OpenAPI/SDK AI-4 單編者，P03/P04 AI-1 Auth domain，P05/P06 AI-0/AI-3 事件/稽核。

## 5. D06 事件核心 vs 私密安全封套：欄位逐一映射與最小化
| Layer 1 業務/稽核 core（來源 P05 11 欄） | AI-1 建議安全來源與處置 |
|---|---|
| `event_id` | Server authoritative random ID；不可原樣用 session ID 或 bearer |
| `event_type` | Auth revoke / first claim / profile CAS 等**候選類型**，事件名稱仍需 AI-0 正式版 |
| `schema_version` | 獨立業務 schema version；**不可**無決議等同私密 envelope 的版本 |
| `brand_id` | server pinned `starry` |
| `app_id` | server registry pinned `starry-id`（此 slice）；禁止用客戶端任意 App header |
| `environment` | server-owned development/staging/production；目前不得發布 production |
| `occurred_at` | 原子 commit 後明確時間語義待定；不可直接等同 envelope `issued_at` |
| `correlation_id` | 去敏關聯 ID，不能塞入原 session/user PII |
| `resource_type` | Member/Session 等候選分類，批准事件表待定 |
| `resource_id` | **隱私風險欄位**：不得直接放 `s_user_id`、session ID、provider sub；需審合法不可逆替代、權限與保留 |
| `result` | success / denied 等候選結果，只有 commit verified 後才可表示 success |
| 條件 `idempotency_key` | 僅真重試／支付等適用；不可 raw bearer/refresh secret/hash 或外部敏感資料 |

**Layer 2（私密封套候選、NOT FINAL）：** issuer、KID、簽章、獨立 `issued_at`／nonce／防重放、current AuthVersion＋SessionVersion fencing、hashed **non-reversible** session/actor references、event_id/correlation/idempotency binding、authorization scope與 commit/outbox receipt、安全 key rotation/anti-PITR witness。這些是**不公開的後端安全証明**，應有版本與獨立ACL；不得複製 Layer 2 進 Layer 1，也不得把私密資料當成P05第13欄或R006的17欄正式核定。

`src/w1-auth-boundary-contract.ts` 只核對公開欄位**名稱清單**、拒絕塞入私密/額外/第13欄且一律 `may_publish=false`，**不是事件資料／簽章驗證器**。不接 Queue、不 emit 真事件。

## 6. 需求 Source IDs（真 GitHub 128 headings + R8 decision；並非條款全文）
來源 `docs/requirements/original-inventory.v0.json` Git blob `7a3131bc1a92d73145091a8bae51cb4aa135780c` 與 `source-reconciliation-r8.v0.json` Git blob `13f386a9c1defd2ac945e2235f5e237bafa07057`；原資料 `source_clause_reconciled_count=0`，**只有索引與 R8 歷史分類，不得冒稱已審核原文條款**。AI0 #243 將 22 身分/會員核心排 P0 + 12 支撐，請勿重建 128 種索引。

| 領域 | 真實來源 IDs | 判定與既有代碼／缺口 |
|---|---|---|
| 登入與 Session | `01.01–01.08` | `01.01/01.02` 已有 `oidc-crypto.ts`／`round5-oidc-gate.ts` 等離線；`01.03/01.04/01.06` 有 `index.ts`／`session-persistence.ts`／R008 CAS；`01.05` 被新決議 superseded，**不恢復跨品牌 SSO**；`01.07` 家庭切換細節待審；`01.08` 登入救援仍缺實際外部流程 |
| 會員資料／隱私 | `02.01,02.02,02.03,02.04,02.07,02.08,02.09,02.10` | `02.01` 本人五欄 GET #244/#245；`02.08` 有 `updateProfileCAS` 候選；`02.09` 有 `publicDirectoryProjection` 離線；`02.02` 手機、`02.03` 頭像、`02.04` 生日、`02.10` 欄位更動 metadata **不在五欄 GET**，不能當全部會員資料已完成；`02.07` autosave 舊方向 superseded，不能復活 |
| 權限與生命週期 | `05.01,05.04,05.05,05.06,05.08,05.09` | `05.04` `requireMemberAdmin`／`round7-admin` 離線；`05.05/05.06` 高風險復權待審；`05.08` 刪帳與 round10–20 復原候選，但 Q104/Q119 法遵條件未核；`05.09` 本人讀已做隔離，管理端閱覽仍需 RBAC 審批；`05.01` 舊雙最高管理者方案 superseded，不得重建 |
| 管理預留 | `P01–P06` | P01 app/env registry AI-4，P02 shared OpenAPI/SDK AI-4，P03/P04 protected Auth permission AI-1，P05 AI0/AI3 分層事件，P06 AI3 稽核＋各域最小必要來源。以上不代表正式後台 API 已上線 |

機讀全 22 列 R8 decision class 保存在 `W1-AUTH-SOURCE-MAP.v1.json`，其 Node regression 會直接比對真 repo 原始索引，**不重新判定 owner 的正文語義**。

## 7. 新增安全檢查與交接
- 新增一個 AI-1-only **無 side effect 的欄位名稱與路由 metadata review guard**，拒絕 unknown／raw token／session/private envelope 混入 public P05 core、拒絕錯品牌、錯 app、非 GET、意外 client 身分欄或原型／getter。所有輸出 **review_only/denied，永遠 publish/ACK/Live false**。
- 新增獨立 Node security regression，讀真 128 索引/R8 22 source ID 對照，確認三項 superseded 不復活、D00/D06/D87 不升 Release Gate；既有 handler/client/R008 完全不修改。
- AI-0 收件：依 #244/#245 的真 code review 認定 canonical 5欄路徑、初驗401 vs final503、單一 Auth writer 原子 proposal；AI-4 用本審查轉正式 shared OpenAPI/SDK/Worker 時另開獨立PR；AI-3審 D06 private envelope P05/P06；需另裁決合法保留／#87實體交易表／真資源授權。
- Rollback：close this Draft / discard 4 new AI-1 paths。所有 #242/#243/#244/#245、R008 Owner/main 全不變。
