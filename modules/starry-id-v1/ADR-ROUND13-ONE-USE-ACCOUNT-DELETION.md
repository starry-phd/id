# AI-1 R13｜Q88 刪帳二次驗證持久化 One-use CAS + 單 SQL 原子撤銷（離線）

**固定基準**：[AI-0 R12 同版整合 Draft #94](https://github.com/starry-phd/id/pull/94) \`4a11b387d32aba789c905e03291f3bc18ebd71d6\`；[總指揮 Issue #1](https://github.com/starry-phd/id/issues/1)、[Git Tree SOP #70](https://github.com/starry-phd/id/pull/70)。所有變更 \`modules/starry-id-v1/**\`，H-Global 暫停。

## 本輪具體新增
- 舊 R7 離線刪帳使用已驗證 WeakSet challenge、Member CAS + ALL Session revoke + deletion outbox D1-shaped batch，但 **相同二次驗證物件本身未永久標示已使用**，安全性主要依賴 Member CAS。R13 沒有重作 R12 RSA 復原見證，而是增加獨立的**持久一次性刪帳二因子消耗**。
- \`src/index.ts\` 的 \`DeletionChallenge\` 向後相容**可選** \`challenge_ref\`（僅受信驗證端核證後簽發隨機 256-bit Hex 引用，非 OTP/Session Token；老版可無此欄）。\`createDeletionChallengeVerifier\` 若宣稱有 challenge_ref，就先嚴格確認格式；不輸出任何臨時客戶可寫的 admin/verified flag。
- 新 \`src/round13-one-use-deletion.ts\` 的 \`createOfflineOneUseAccountDeletion\` 預設 OFF、僅 Starry development/staging、只吃既有受信 WeakSet Principal + WeakSet 第二因素 challenge；重讀當前 Member/auth_version，用**單一 prepared UPDATE** CAS \`challenge_ref + user_id + session_id + version + TTL + consumed_at NULL\`，SQL callback 只有成功一列才報 true；亂數二因子 proof 由外部受信 backend 出具並**事先寫在同一個 Auth D1 中**，此 PR 沒有提供或開啟真 Apple/Google/Passkey/TOTP 認證 route。
- \`schema/011_starry_one_use_deletion.UP/DOWN.DRAFT.sql\`：與 Starry Member／Session／Deletion Outbox 同一 Auth 資料庫、供 SQLite \`:memory:\` 運作的 pending challenge+唯一 event、最多 5 分鐘 expires、不可把 consumed_at 清回 NULL；\`BEFORE UPDATE\` trigger **在單一 SQL statement 內重新查當下 active Member + auth_version + 未撤銷/未過期 Session**，不依賴 JS 早先讀的快照；\`AFTER UPDATE\` trigger 同一 SQLite 交易原子完成「challenge consumed + Member status deleted/auth_version bump + ALL Starry Apps Session revoke + 單筆最小 outbox」。任一步驟唯一鍵/約束錯誤全句 rollback，觸發 R10 事件計數隨同交易正常計數。**沒有跨不同 Cloudflare D1 交易保證**。
- \`test/round13-one-use-deletion.test.mjs\` 對 WeakSet proof、scope、首次消耗、偽造、expired/version/pending、已撤銷、DB failure 做正反測；\`test/test_round13_one_use_deletion.py\` 用真 SQLite \`:memory:\` 執行 trigger，驗**只一次**、其它 Starry App 全 Session revoke、刪帳 outbox、兩次挑戰競態、碰撞約束完整 rollback、外層 transaction rollback、撤回 proof 不能復活、Up/Down 幂等測試。

## 必須保留的 Gate
- **真正 Backend 認證/Key Management**：高熵 challenge_ref 必須在正式獨立 Step-up 驗證完成後由 server 產生與記錄；不能由 User JSON、前端端點或 static test vector 供應。現版 R13 只是適配新的可信 challenge_ref 和關聯 Auth D1 資料，沒有簽發/認證實現。
- **當下交易範圍**：只對 *同一 Starry Auth D1* 的 Member/Session/Outbox/challenge 成立；AI-3 Battery／AI-4 Task 仍在不同權威，無跨 D1 原子性／跨服務撤銷通知，AI-0 [跨 D1 ADR #87](https://github.com/starry-phd/id/pull/87) Option A/B 未核准。舊 R7 仍是另一個**預設 OFF** 的離線 adapter，正式 Worker 必須禁止遺留路由繞過新版單次 proof。
- **隱私 Q104/Q119**：legal hold、Retention/Purge、同官方 Identity 刪帳重註不得再領首註電池、Step-up Audit/反濫用政策均未獲正式法律/業主 Gate，不能藉由 Session 撤銷直接允許匿名申訴/資料擦除/已領 X 再贈。
- **真正 D1/Cloudflare** Trigger 相容性、D1 consistency/durable backup、併發重試與合法 Step-up、Recovery rollback/PITR 都必須在受控環境另行驗收。只有 GitHub CI SQLite :memory:、D1-shaped mock；**正式 G00–G10 11/11 BLOCKED；P05 禁止 publish；no main merge/deploy/Store/EAS/paid；H-Global 繼續暫停。**
