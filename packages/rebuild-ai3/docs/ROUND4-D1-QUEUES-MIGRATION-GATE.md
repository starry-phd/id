# AI-3｜第四輪 D1／Queue／P05 安全實作與啟用前 Gate

來源：AI-0 [第三輪整合 PR #40](https://github.com/starry-phd/id/pull/40) 固定 SHA 6d7c54e8c8eecdde810a83932ac9f6bc6fee53fd，AI-3 Issue #4 第四輪、DEV-I Google Docs 2026-10-26 最終 EAS 八項成本控管規則。

狀態：僅離線安全候選。沒有 Cloudflare D1/Queues、Secrets、真實付款、部署、EAS Build 或付費操作。

## 唯一權威及 13 欄 P05

- AI-0 唯一擁有全域 canonical P05 事件格式、來源驗證與事件白名單。第四輪只以 AI-2 的 billing.p05.v1-candidate 為離線契約；AI-3 rebuild-ai3.0.1-candidate 僅是另一種 Audit storage schema version，並非兩者已正式核准上線。
- AI-1 唯一擁有受驗 Principal 與 Session；AI-2 唯一擁有 verified Sandbox provider、Billing owner/entitlement/outbox 同域提交；AI-3 唯一擁有 audit/inbox/quarantine，AI-4 唯一擁有實際 Worker/Queue binding 與 Expo App。
- 接收來源必須是 AI-2 伺服端 verified 且真正 committed 的 outbox row，經 AI-0 canonical gate。禁止將 Queue message 或 HTTP 的 committed/provider_verified boolean 當真實 provider attestation。拒絕跨品牌/App/環境、不合法時間戳、假 actor、PII、原始收據與未知欄位。

## Offline D1/Queue 設計

- 新 D1-shaped Adapter 使用 Cloudflare D1 prepare/bind 與單一 batch transaction，先 claim 再 audit append，於同批次讀回 idempotency key、event_id、payload_digest 和所有固定稽核欄，只有雙表一致確認才回 inserted／duplicate；衝突返回 conflict，異常不 ACK。SQLite in-memory 的真 SQL + 雙連線測試覆蓋 crash before commit、lost ACK replay、唯一性、scope isolation 和 rollback。此證據不是 Live D1 多 Worker 併發 Gate。
- Quarantine 僅保存事件 hash ref、scope 和 allowlisted reason，回讀確認後才可 ACK。AI-2 order port 回報 superseded 的延遲事件先 quarantine；unknown／不可達則 retry/死信，不自行改變付款權益。此為候選保守策略，退款業務政策待 AI-0 批准。
- Cloudflare Queues 預設 handler 正常 return 可能自動 ACK，因此離線 Queue adapter 對非成功情況明確呼叫 retry，並在收到持久 DLQ 成功回執之前永不 ACK。需要將 Queue 的 max_retries 和 AI-3 限次策略於真配置時一致核准；不在 AI-3 直接開通真 Worker Queue。
- 人工 replay 仍是 review_only；需 AI-1 現行 grant / 強化驗證、AI-0 對二次批准和保留法遵規則決議，不直接重送付款與刪帳事件。Battery 永久免費、Starry-only，不啟用錢包、FEFO、餘額或扣抵。

## D1/Queue 真環境執行前 Gate（只規劃，不執行）

1. AI-0 核准 P05 version/event allowlist、個資稽核保留、物理 D1/DO 配置及正式核准功能來源。
2. AI-2 提供後端 verified Provider、server-only after-commit source reader、order/digest、帳戶權益 CAS 與隔離證據。
3. 由 AI-4 經審核設置 Starry 專屬 D1/Queue/DLQ；最小權限、Staging/Production/跨品牌隔離、Secrets 及旋轉、無付款寫權給 AI-3。
4. Migration 0004 先備份、檢查約束、執行 SQLite/隔離 D1 演練、記錄 commit SHA 與 restore point；需獨立授權才可 Apply 真 D1。失敗先停止寫入，由 AI-0 審核基於備份的復原與清理，不可自行 DROP。
5. Queue 出錯與 DLQ 的寫入認證、可讀權限、重試上限、可觀測指標和復原流程需預演並留證據，未成功持久 DLQ/Quarantine 不可 ACK。
6. AI-4 實機 iOS/Android、Expo EAS Build/Update/Workflows 分開控額。DEV-I 最終版要求每 PR 必跑品質 CI，但不得自動 EAS Build；需要原生登入、付款、推播時應在核准下做必要實機／商店 Sandbox 驗收，不可為省費省略。
7. 成本與發布證據留 brand_id/app_id/environment、PR、commit_sha、CI/EAS Build ID/額度與費用來源；估計費用不得冒充真實帳單。若額度不足，提替代方案先經業主核准，不擅自購買付費/超額服務。

## 安全範圍

CI 僅 strict TS、Node 契約與負向測試、SQLite :memory:。沒有跑 EAS/Expo 雲端、Wrangler migrate/deploy、真 Store 訂閱或 Cloudflare 付費服務。Gate 0 仍有 25 seed + 128 原始索引待逐項 reconciliation；服務 Gate1 尚未解封。
