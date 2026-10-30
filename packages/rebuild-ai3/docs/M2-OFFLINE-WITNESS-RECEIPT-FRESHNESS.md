# AI-3｜M2/M4 PITR Witness 離線驗證補強：Freshness／Digest／防重播

**Status: source-only review; NOT a production witness or restore approval.** Baseline main `f153aa601e0a1971366edd9fc5e44b439d2f3c8f`; [最新開發技術規範](https://docs.google.com/document/d/1urLja9i9A63jHuz4jQPhPMTgoCtoq-i1TafXPQd3PYU) v1.0（2026-10-30 S2）、UP-03/05/10/11/15/17/22；AI-0 [#220](https://github.com/starry-phd/id/issues/220)，[AI-3 #4](https://github.com/starry-phd/id/issues/4)。

## 新增價值（不重做 #270/#274）

已合 #274 的 `m2-offline-pitr-reconciliation.ts` 比對合成快照與合成 witness 的 member/session/deleted/auth_version，但接受未認證的 caller-provided witness，且沒有證據可判斷 **witness 比快照更舊、兩份內容是否綁定、是否重放過期證據**。它本身永遠 quarantine，不可當正式發布授權。

本次新增 `../src/m2-offline-witness-receipt.ts` 作為 **#274 的額外證據檢查，不是替代**：

1. 先委派原 `reviewOfflinePitrCandidate` 進行現有 scope、版本與復活風險檢查。
2. 對 candidate 和 witness 的**白名單欄位**建立有序 canonical representation，SHA-256 digest；固定 Starry app/env、snapshot/witness generation、nonce、時間和 KID 以 domain-separated HMAC receipt 綁定。
3. 只由**呼叫端可信的** pinned/non-extractable WebCrypto verification key、fresh expected nonce、單調 minimum witness generation、clock 驗證；拒未知 KID、錯 brand/env、production、過期/future、witness older than snapshot、hash/MAC 不符、結構/多餘「approved」欄、偽造 independent witness 表示。
4. 保留原 #274 回報的 rollback/deleted/session risk；即使本機 HMAC 有效，回傳依然永遠 `quarantined_review_required`、`may_restore/may_open_api/may_grant_battery/may_ack_queue=false`、`independently_verified=false`。**這不是可用簽章證據授權還原的方案。**

**絕不能誤解為：** 該模組沒有 HMAC 產生、沒有機密值、沒有連上獨立儲存、沒有治理可靠金鑰、沒有真實單調 checkpoint 或保留期限的權威。HMAC 只能證明本機測試證據與測試金鑰吻合；物理獨立性、完整性、不可回滾性、Q104/Q119 合法保留、實際 D1 Time Travel/PITR／刪帳與完整恢復重播全部仍 blocked。不能將測試金鑰或 fixture 對應正式環境。

## 真實測試出口與交接

`../test/m2-offline-witness-receipt.test.mjs` 用 test-only WebCrypto HMAC 實際簽署，驗來源和快照 digest 綁定，含資料變造、收據重播、過期、來源較舊、wrong key/KID、環境、未核准 flag、getter 偽造、不同排列 canonical 等負例。所有副作用仍 0；AI1/AI2/AI4 的檔案不變。

AI-1 [#276](https://github.com/starry-phd/id/pull/276) 已合 source-side `003_m2_local_member_self_mutations.DRAFT.sql`：profile audit `environment=NULL`（唯一物理 D1 綁定環境尚未核准），`s_user_id` 和 `session_id` 雖不記顯示姓名仍屬可能的連結識別，Q104/Q119 的實際保留/刪除治理不可跳過；trigger 在 SQL statement 內隨成功原子化，**不代表真 outbox/ACK、刪帳完成、獨立 witness**。本輪不修改 AI-1 的 DB schema；給 AI-1 的後續法遵/事件契約 review 另在 GitHub 留痕。

停止/回退：本次僅新增 AI3 專屬檔，可保留 Draft 或依批准後合併，由 AI-0 決定；沒有遠端部署／變更，Git 回退不解除任何正式 Gate。Battery 永久免費、首贈資格未核准保持 HOLD，Ads OFF；HGlobal/Echo 不介入。

## 同 PR 第二輪安全修補（AI-0 合成驗收後）

Review 自我驗證發現新 `receipt` 與 trusted KID/nonce/clock 的 JavaScript 物件原本在 SHA-256 與 `crypto.subtle.verify` 的 `await` 期間仍可被其他呼叫端修改，可能讓先前白名單檢查與最後 MAC 驗證看到**不同版本的輸入**。現行程式先嚴格檢查 receipt/trust 各自的欄位、拒絕 getter/未知參數，再在第一個 `await` 之前固定欄位快照與不變 `CryptoKey` 參照；所有 envelope、digest 與核對均從單一快照讀取。額外拒絕非標準的 HMAC-SHA256 key／非 canonical 32-byte MAC 編碼。新增可執行 mutation-on-await／digest 值變更／trust getter 偽裝／替代 base64url 最後兩個 bits 的負測，並直接 `tsc --strict` 檢查新來源。這是**真正的 TOCTOU 簽章驗證缺陷修補**，不是重建 #274 或假造真獨立 witness。最新 exact PR HEAD／CI 應以 GitHub 最後一次成功的同 SHA 為準，舊 #41000179655 僅初版。

## 2026-10-30｜對最新 main 物理刪帳申請／Billing 的整合複查與真風險修正

AI-0 [Issue #4 新工令 #6521206483](https://github.com/starry-phd/id/issues/4#issuecomment-6521206483)；開始時驗證 main [`b4d5287ce45dd7e89bc0d33894a7ed9f0c92c832`](https://github.com/starry-phd/id/commit/b4d5287ce45dd7e89bc0d33894a7ed9f0c92c832)／合後 [CI #41032905863](https://github.com/starry-phd/id/actions/runs/41032905863) 已成功，包含 **#278 Billing、#291 本地刪帳申請、#293 手機刪帳 UI/typed SDK**。既有 #280 本身只處理 synthetic PITR 候選／witness 和 HMAC，未取代上述任何 source-authoritative 領域，也沒有引入第二套 Auth／Billing／刪帳狀態；GitHub PR CI 必須以**最新 main + #280 HEAD 的合成 checkout commit/tree**查核，不能僅拿舊基底 CI 當整合成功。

**實際驗證一致性缺陷（本次已改原碼）**：舊 `reviewOfflinePitrWitnessReceipt` 先把呼叫端可變 `candidate.members`／`witness.records` 交 `reviewOfflinePitrCandidate` 形成 `source_risks`，接著又從**相同呼叫端物件**讀第二次計算 HMAC 所保護的 SHA-256 digest。具狀態的 Proxy/可變陣列可在前後讀取提供不同 member／deleted flags，造成 `receipt=offline_authenticated` 但 `source_risks` 其實評估另一份資料。這不是合法授權問題，而是可重現的**簽章摘要與風險判讀不一致**。

修補：先於**任何 await** 前，以 own data descriptors 同步擷取深層 candidate／witness 的 primitive-only bounded snapshot（最多 500 members/records、每 member 最多 50 sessions；拒存取器與陣列元素 getter，不共享任何來源陣列），**同一個不可變快照**分別交原 `reviewOfflinePitrCandidate` 的嚴格 schema validation、`canonicalCandidate/Witness` 及後續 SHA/HMAC，比對一致。新增兩個真實 mutable proxy 的 candidate／witness 矛盾 negative tests、陣列 getter 不執行測試；保留舊 16 cases（含合法重排、signature/TOCTOU、strict TypeScript），不是重做 #274 或添加同義 HOLD 工具。結果仍可能僅標 `offline_authenticated` 作為 **HMAC 綁定合成資料的描述**；所有正式操作一律禁止。

**最新 004／物理刪帳互鎖：** main 新 `modules/starry-id-v1/schema/004_m2_local_deletion_request_receipt.DRAFT.sql` 有 `starry_m2_deletion_requests.s_user_id → starry_members` **直接 FK**，另有 `starry_m2_deletion_request_audit.request_id → deletion_requests` **間接 audit FK**；main 已合 #288 的真 SQLite preflight 對前者仍報 `UNRECOGNIZED_MEMBER_FOREIGN_KEY`，且 `LEGAL_DISPOSITION_NOT_APPROVED`、`EXTERNAL_ERASURE_AND_PITR_UNVERIFIED` 持續阻擋。#280 的合成 receipt **沒有，也絕不能**被當成 004 的申請完成證明、刪帳成功、跨 Store 首贈重領資格或 PITR 外部見證；#293 顯示 `pending_processing` 僅代表**申請受理**。本 PR 沒有將 audit.request_id、個資或未核 retention 時限塞進 HMAC trust，亦未擅改 AI1 schema/AI4 UI。

**AI-2 Billing 審查出口：** #278 的商店／退款／首贈與 PITR 跨邊界由 AI-2 唯一定向 review；本 AI3 不修改 Billing 原碼，不對任何新/舊 Store entitlement、first-grant 或 receipt 給予復原/ACK 權限。S2-08/09/10/11、Q104/Q119 逐類法定目的/期限/最小化、真獨立且不可回滾 witness custody、真受控 D1 刪除與 restore replay、Store 所有權／外部 processor 與商店訂閱取消流程仍待各 Owner 和 AI-0 審核。

可回退性：以上均為 AI3 local synthetic verifier、測試與文件；PR 未合併、未在遠端作任何 PITR/會員操作、未建雲端資源或產生費用。CI 成功表示**source+main 合成測試**，絕不表示外部獨立 witness 已驗證、staging/production 已部署或 release Gate 解鎖。
