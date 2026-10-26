# AI-0｜P05 Billing → Audit 唯一傳輸候選規格（2026-10-26）

狀態：工程候選／**不代表業主已核准正式 P05 版號或可發布事件**。根據 AI-0 PR #40 與 AI-2 #36、AI-3 #39 之當前契約。供第四輪跨 AI 討論及測試使用。

## 三個不同層級，不得混用
- AI-2 Billing D1 transaction：服務端完成 provider 驗證後，必須在同一 Billing D1 交易寫 owner claim、provider event、entitlement 和 outbox。payload_digest 屬可信已提交 row，不是 P05 transport 欄位。
- AI-0 P05 transport：候選版本 billing.p05.v1-candidate；嚴格 13 個 metadata-only 欄位。
- AI-3 Audit D1 row：現行 rebuild-ai3.0.1-candidate 是稽核資料內部版號，**不是** P05 transport 版號。AI-3 inbox claim 與 Audit append 應同一 D1 原子提交。

## 唯一候選 13 欄（snake_case）
brand_id、app_id、environment、schema_version、event_id、event_type、occurred_at、correlation_id、idempotency_key、actor_ref、resource_ref、result、classification。

- brand_id=starry，app_id=server-owned trusted scope，environment 僅 development 或 staging。
- schema_version=billing.p05.v1-candidate，event_type=billing.store_state_observed。
- event_id=correlation_id=idempotency_key=resource_ref，全部為 server-generated b_ 加 64 字元小寫 SHA256 hex。
- actor_ref 必須由服務端提供不可逆假名，僅允許 anon_/actor_/audit_/opaque_ 前綴；絕不可填原始 user_id、姓名、Email 或 provider token。
- occurred_at 必須合法 RFC3339 帶時區，從可信 provider time 取得。
- result=recorded、classification=metadata_only；其他值全部不接受。
- 拒絕任何額外欄位或隱藏/getter/symbol 欄位；不允許 raw JWS、receipt、payment token、store_environment、client verified/admin flags、PII、跨品牌與 production。

## 安全邊界與驗收
1. isCandidate 只做格式及受信 Scope 比對。**不能認定事件來自 Billing D1、不能發 Queue、不能 ACK、不能發放權益、不能解鎖正式付款**。
2. AI-2 唯一權威為已提交之 Billing 資料，AI-4 後續需從 server-only 權限讀取，不可直接信任 HTTP 上報 committed/provider_verified。
3. AI-3 在原子 claim+audit 成功後才 ACK。Digest 變更須持久 quarantine；隔離 D1 寫入失敗不得 ACK；Queue／D1 無法存取應重試與 DLQ。
4. 真實 provider JWKS/Apple PKI、Store Sandbox 購買、D1/Queue 多工作者故障及回滾尚未執行，Gate0/1 持續 BLOCKED。
5. DEV-I 2026-10-26 成本規則優先；每 PR 自動 CI，但不預設啟動 EAS 雲端原生 Build，任何付費先經業主核准。

## 本次可執行自動驗收
node --experimental-strip-types --test packages/ai0-contracts/test/*.test.mjs

測試比較 AI-0 與最新 AI-3 13 欄容許條件、版本/Scope/PII/時間負測試，及 **即使格式有效，AI-0 不核准也不得成功寫入或 ACK**。

AI-1～AI-4 可以使用此候選 schema 討論介面，但不得將此檔案的 PASS 標記為真實服務或正式發行驗收。
