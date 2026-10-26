# AI-4 第二輪｜Billing → Audit 事件 DTO 候選（未核准、不可發送）
依據：AI-0 [整合 #30](https://github.com/starry-phd/id/pull/30)、AI-2 [#29](https://github.com/starry-phd/id/pull/29)、AI-3 [#28](https://github.com/starry-phd/id/pull/28)；AI-0 尚未核准單一 P05 schema。

- AI-2 `planSandboxPurchase` 唯一 owner 產生 server-only `OutboxCandidate`；內含 `billing.store_state_observed`、`idempotencyKey`、`storeEnvironment=sandbox`、Worker `environment=development|staging`。
- AI-3 `EVENT_KINDS` 暫不包含這個 Billing 類型，`isAuditMetadata` 必須拒收；**禁止 AI-4 假裝它是有效 `identity.session.revoked`**。
- 本輪 `proposeBillingAuditEnvelope` 是唯讀轉換，`publishable=false`、schema_version=`candidate-not-approved`；跨品牌、跨 App、跨 runtime／store env、缺鍵、夾帶額外欄位一律 QUARANTINE。沒有 Queue、D1、Billing entitlement 或真實事件發送。
- **待 AI-0 裁決：** canonical P05 event/version、event_type 白名單、snake_case DTO、可信 issuer、app_id/environment、Store sandbox separate axis、event_id/idempotency key/payload digest 的持久唯一鍵與重播衝突判定。AI-2 擁有原子 Billing outbox；AI-3 擁有稽核 inbox/唯一寫入者；跨 D1 Queue 中斷需重試/補償 ADR。
- 測試以 AI-1 minted principal → AI-2 sandbox plan → 此候選 DTO → AI-3 validator **明確拒絕** 證實接口缺口，不宣稱端到端 Queue/Audit Gate 已過。
