# AI-4 R19｜Four-domain private offline Saga wiring（實際代碼 + 負測，正式 Gate 仍封鎖）

**唯一來源：** GitHub AI-0 #1 / AI-4 #5 R19 派工、最新 [AI-0 R18 真四 Owner 同版整合 #131](https://github.com/starry-phd/id/pull/131) FINAL `f006e90311b3fecedae0f7c75004c940adfacede`、#70 單 Tree SOP、#87 未決 A/B ADR。R18 原 14 blobs 已在基準內，**本輪不重做 R18，也不改 AI1/2/3 writer**。

## R19 owner 代碼與相容性邊界
- `apps/api/src/round19-offline-four-domain-wiring.ts` 只建立 PRIVATE / OFFLINE / 預設 LIVE=false 的四領域讀回協調器，唯一入口為 Starry dev/staging opaque eventRef + clock；不接受 JSON Auth event、沒有 publish/send/ack/release/wallet/write API。
- **實際引用既有 R18 TypeScript 輸出型別**：AI-1 `AuthR18SourceReview`（已經由 AI-1 原 Auth sealed claim / deletion-time session / lawful retention 本地檢查的 observation）、AI-3 `R18RecoveryResult`（實際 Wallet/Task/floor review-only）、AI-4 `R18SagaResult`（原 R18 CAS/retry/duplicate 本地 SQLite journal）；R19 再要求前後重讀和一致性。單一 AI-1 logical Auth outbox 仍是唯一事件來源。
- **AI-2 Billing / Task 缺正式共同 canonical deletion receipt DTO**，只定義 **嚴格 read-only 測試投影**，分離 event/member/env/auth_version、Billing inbox/tombstone/no active entitlement/floor 和 Task status vs Wallet hold。與 [AI-2 R18 refund SQL](https://github.com/starry-phd/id/blob/ai0/r18-four-owner-and-app-roadmap-integration-20261027/packages/rebuild-billing/src/r18-refund-inbox.ts) 的 Store refund `event_ref` **不是**同一個官方刪帳事件身分；不得私自 `event_ref` → `event_id`、`s_user_id` → Billing `m_SHA256` 或 `task_ref` 做任意合併。缺核准映射/來源必須 BLOCKED，不得宣稱正式 Billing 已接通。
- 先查合法處理/合法保留與 pinned version，再讀各 owner；呼叫原 R18 local Saga 只能在所有 owner readbacks 初次一致後；最後重新核對 Auth/Billing/Battery/Task 與政策，檢出 crash/PITR stale、refund floor 或 Task/WALLET 改變，一律 blocked/retry，不得把 local success 當跨 DB ACID。
- 即使所有投影與真正 R18 Saga 本地 CAS 都通過，只回 `local_consistent_review_only`，**永遠** `may_ack_queue=false`, `may_dlq=false`, `may_release_task=false`, `may_settle_task=false`, `may_regrant=false`, `may_restore=false`, `may_publish=false`, `publishable=false`, `live=false`。

## 離線可執行測試
- `apps/api/test/round19-offline-four-domain-wiring.test.mjs`：五個物理獨立 disposable `node:sqlite :memory:` connections（Auth、Billing、Battery、Task 讀回測試投影 + AI-4 R18 真本地 CAS journal）；直接執行 `createR18OfflineSagaTransport` 原 R18 code，觀察 fenced lease、重送/ACK lost、局部失敗/補齊、policy drift、PITR 回退、缺 Auth/Billing/Battery/Task、Task settled-vs-wallet-hold 矛盾、冒用 publisher/ACK、跨品牌/env、缺保留合法性。
- **這些測試的 Billing/Task 刪帳讀回表屬新 private disposable 測試投影**（非 AI-2/AI-3 真正式資料庫）；AI-1/AI-3 的既有 R18 模組真 SQL/Node/Python 測試會被同一 CI checkout 全量執行，但尚無跨域核准資料轉換方案。不能以 root full CI 所包含的各 Owner 測試，假稱所有 R19 連接都已由正式 owner Authority 核准。
- 驗證：R19 Draft PR 自動 GitHub Actions [AI-0 Current Complete Offline Gate]（npm ci、strict TypeScript + ESLint、全部四 Owner Node/SQLite :memory:、128 SSOT、11 G00-G10 `--assert-blocked`、Expo Config / Workers dry-run），同 HEAD 的實際 CI 連結與數量以 Github 記錄為準。

## 尚待 AI-0 裁決／跨 Owner 交接
- **AI-1 #2：** 唯一正式 Publisher/issuance/`AuthR18SourceReview` 不是 signed cross-D1 attestation；須核真正 canonical P05、Q104/Q119 合法 retention、來源 lease 與不可回退 witness/KMS。
- **AI-2 #3：** Billing `R18 refund` vs `account_deleted` 各有不同 opaque event/digest/member namespace；請提供已核准 **只讀**刪帳 tombstone+Store/refund floor+全 SKU 無活躍權益的 domain receipt（含 source version）。AI-4 不寫 Billing DB。
- **AI-3 #4：** Battery wallet/Task hold `task_ref` 和 AI-4 Task 狀態須共同有合法/持久化的 no-regrant/no-settle fence；AI-3 真 `R18RecoveryResult` 即使一致也只 review_only。請提供跨 owner immutable task/member/env + journal revision 的唯讀契約。
- **AI-0 #1 / #87：** A Starry single transaction authority vs B durable Saga *尚未正式決議*；須先確認物理各 D1、真 Store 來源、anti-PITR floor、lawful retention、Queue ACK-after-commit/DLQ retry semantics、簽名 Key custody、可能支出和允許測試環境。拒絕以 R19 local SQLite success 代替任一 Gate。

**Release G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false，Battery 免費且不可轉售。** 不合併 main、不 Preview/Staging/Production、不真 Cloudflare D1/R2/Queue/Secrets/OAuth/Store/EAS、不收費／付費、不動 H-Global。
