# AI-3｜SBASE-20261028｜BatteryClient / Audit-Recovery 最小候選合約

**權威：** [總管 #156](https://github.com/starry-phd/id/issues/156)、[AI-3 最新派工 #4](https://github.com/starry-phd/id/issues/4#issuecomment-6459893402)、[R23 中央限定 #1](https://github.com/starry-phd/id/issues/1#issuecomment-6450351051)、[ADR #87](https://github.com/starry-phd/id/issues/87)、使用者提供《Starry 生態系共用技術基座 v1.0 候選版》2026-10-28。以 [AI-0 中央四 Owner R21 已驗候選 #148](https://github.com/starry-phd/id/pull/148) `fbd5c03156da700b68c7b5bceb65269cb7c900ec` 為非破壞性程式父版；`main` 比它舊、AI-0 SBASE #157 僅從 main 新增架構候選文件。**本 PR 絕不覆蓋/合併任何中央會員 Auth 或業務資料、也不採舊已關閉 App PR #149–#155。**

## 真正交付（只有兩個來源、一組 Node 契約測試與本文件）

1. `src/sbase-battery-client-contract.ts`：明確版本 `starry.battery.client.v0-candidate`，**只限 Starry** `brand_id/app_id/environment` scoped `battery.policy.read`、read-only injected server status port，具型別錯誤碼、Auth revoke readback、後端不可用降級、兩次來源比較、free-only 保護；SDK 完全沒有 getBalance、grant、purchase、reserve、commit、FEFO、expiry、overdraft、Store SKU 或 D1 直連。即使合法 scope、mock Auth active、兩次來源一致，也只回 `candidate_only`，明確 `NOT_APPROVED`，全部業務權限 `false`。適用 30–50 款 Apps 的概念插件 **不是**正式服務 endpoint，SDK 沒有固定 secret。
2. `src/sbase-audit-retry-contract.ts`：重用現有 AI-3 `src/index.ts` 的 `AuditMetadata`、`assertEvent` 與 `CANDIDATE_VERSION`（既有 `rebuild-ai3.0.1-candidate`）；**不另立 AI-0/P05 正式事件版本**。對外只接受注入的未實現 `validateCandidate` (AI-0／AI-4 準權威)、`verifySource` (真正簽章/來源仍待專責核准)、`readDedupe` (真持久收據未實現) 和合法 `lawfulRetentionNow` port。要求 event_id/type/schema_version、brand/app/environment、occurred_at、correlation、idempotency、resource/actor pseudonymous refs、result/classification；重播、跨 App、跨環境、未簽 source、合法留存失效、不同時點資料變動全部封鎖。可配置指數退避 **僅回 review_only 延遲計畫**，超限 `dead_letter_review`；**不真的發 Queue、寫入 DB、發 Email/Push、DLQ、執行 ACK**。永久 `may_ack_queue/may_publish/may_send_notification/may_change_battery/may_restore/live=false`。
3. Node 負測可核對跨品牌、跨 App、production、不明 Auth、revoked late、非法付費字段、政策漂移、假 P05、去重重送/未知、PITR 樣本回退／見證漂移、退避上限、宕機失敗降級。**此 mock 並沒有真的測到 Cloudflare D1 PITR 或跨 D1 物理網路**。既有各回合真 SQLite 裸模擬驗證維持不變。

## 擁有權／下一步（AI-4／AI-0）

| 契約/實體 | Owner | SBASE 狀態 |
|---|---|---|
| `BatteryClient` TypeScript read-only free-policy candidate | AI-3（本 PR） | **IMPLEMENTED / OFFLINE POC**，尚非正式可用 SDK |
| Server Auth/App Registry/scope 授權、真 AuthClient | AI-1 / AI-4 | **PENDING PROVIDER & REGISTRY**，不可從 App JSON 假造 |
| P05 canonical event/envelope 與 API 版本相容 | AI-0 / AI-4；AI-3 只提供現有 AuditMetadata 候選 | **CANDIDATE**，待單一權威、來源簽名核准 |
| Starry Battery 唯一 D1 writer、免費政策 | AI-3 | **已確認永久免費**；Wallet、扣抵、到期等是否正式啟用 **PENDING BUSINESS APPROVAL** |
| 通知、稽核留存、恢復 | AI-3；Q104/Q119、KMS 等法遵與 AI-0/H 協調 | **MOCK ONLY**，無 D1/Queue/PITR 真實證據 |
| 發布、Expo/RN/Store/monorepo/SDK package layout | AI-4 / AI-0 | **PROPOSED / NEED ADR & POC**，不得強制變更 Expo54/npx/npm |
| 真 D1/Queue ACK-after-commit、源簽章、不回退 floor、#87 A/B | AI-0/AI-3/AI-4 相依 | **BLOCKED**，不可以 Node/SQLite 成功當真正跨 D1 ACID |

**相容性/成本/回退**：基於原 Node22 TypeScript strict + Node test；不引入依賴、pnpm/Turbo、Expo SDK58、RevenueCat、AdMob、Cloudflare Binding；GitHub Actions 為離線 CI（GitHub 配額可能計費由帳號計畫決定，本 PR 不使用 Cloudflare/Store/AI 付費 API）；回退只需關閉 Draft 或捨棄此新增四檔，不動中央原始碼。現有 `packages/rebuild-ai3/src/free-battery.ts`、R14–R21 Wallet/Task/Schema 及中央 Auth 都**原封不動**；它們歷史上對某些候選規則寫過 "approved"，不能因此在本 SBASE SDK 重新宣布正式核准。

**Release**：G00–G10 仍 11/11 BLOCKED；P05/PUBLISHABLE=false。不合併 main、不部署 Preview/Staging/Prod、不使用真 D1/R2/Queue/KMS/OAuth、Store/EAS、付費/金流/H-Global。AI-0 收到四 Owner 真 PR/CI 才建立新的四組整合 SHA。GitHub Issue 只負責持久交接，不會自行喚醒其他 ChatGPT 對話。
