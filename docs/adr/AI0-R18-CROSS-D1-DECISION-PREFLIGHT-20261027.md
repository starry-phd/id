# AI-0 R18｜跨 D1 架構決策與安全 Gate 前置驗收（Draft／僅離線）
> Starry-only · GitHub SSOT · 2026-10-27 · **尚未核准 A 或 B；不發佈、不付費**。

## 固定工程基準
- 最後一份已完成四 Owner 同版 **離線** CI：[AI-0 R17 整合 Draft #123](https://github.com/starry-phd/id/pull/123) `f84eab58e20377b5bd1ce313b969befb531b4938`，建立於已驗證 R16 [#122](https://github.com/starry-phd/id/pull/122) `2d95908e07485eedf4842b5ccd799d4a63a2b8ea` 之上。
- 決策來源 [#87 跨 D1 ADR](https://github.com/starry-phd/id/pull/87) 及 [AI-0 Issue #1](https://github.com/starry-phd/id/issues/1)；本 R18 規劃補充，不替代 #87。
- 唯一**正式**發布 Gate：`docs/release-readiness/release-readiness.v0.json`，G00–G10 **11/11 BLOCKED**、`P05/PUBLISHABLE=false`。
- Git Tree/CI [#70 SOP](https://github.com/starry-phd/id/pull/70)，各 Owner GitHub Issues #2～#5。此 PR **只新增 AI-0 風險／可執行測試檔**，沒有覆寫四組 R17 已提交程式、CI YAML 或任何真實資料。

## 對跨 D1 的工程結論（限制性）
1. **已成立的負面結論**：Auth、Billing、Battery、Task、Audit 在不同 D1 時，個別 commit／兩次 readback／各 Owner CI success 都不構成全域 ACID、exactly-once delivery 或正式 Queue ACK 的證明。不能用環境相同、事件 ID 相同、簽章模擬或本地 SQLite 註冊成真實原子性。
2. **候選 A：Starry 專用單一交易權威**。可評估將*極少量*同一原子交易必需的 claim/Wallet 操作放在同一 Starry 權威 DB；不得推論要合併所有模組 DB，更不可與 H-Global 共享。仍要獨立法遵、最小資料、Owner 寫入界線與實體資源批准。
3. **候選 B：獨立 D1 + committed outbox / durable inbox / 補償 Saga**。適合維持模組隔離的**離線研究優先路線**，但不代表選定；需要完整事件版本、唯一已提交來源、sink 原子防重、ACK-after-durable-readback 的實環境測試、獨立不可回退證據、逆序事件、安全 DLQ/補償和實際成本。
4. **方案 C：快照讀後寫跨 DB**。只能留作負面測試對照，**禁止用於正式授權**。
5. **目前沒有業主正式選擇 A/B**；`AI-1_AUTH_COMMITTED_OUTBOX` 是邏輯唯一刪帳事件候選來源，不等於已啟用並合法簽發的 Cloudflare 唯一 Publisher。任何 R18 介面都只能在 mock / disposable SQLite 測試，不可暴露真 Worker 路由。

## R18 中央 Gate：失敗即拒絕
- Source：合法目的、已刪除會員＋撤銷 Session、出庫事件 commit、固定 policy/version、來源可信簽章與輪換政策；任何不明確→ BLOCKED/REVIEW_ONLY。
- Dispatch：不能產生第二個 account_deleted；連續重試／並發租約／跨品牌跨環境須 fail-closed；不可因 queue 收到事件而提前 ACK。
- Sinks：AI-2 Billing、AI-3 Battery、AI-4 Task 必須由**各自 Owner**控制本域寫入及同 DB receipt；其中任何缺少、過舊或衝突，總狀態是待補償/審閱，不是成功。
- Recovery：PITR／舊快照復活 tombstone、撤權、付款權益或首次贈送，若缺獨立不可回退證據則 **review_only**；不可自動補發/重授/復原。
- 法遵與正式成本：Q104/Q119 的合法保留、HMAC/KMS、刪除/撤回和實際值；P05 schema/version、Store/Queue/DLQ/D1、首款 App 與付費上限**一律待業主/法遵及正式環境核准**。

## 五組權責與啟動條件
- AI-0：維護 **單一**架構候選矩陣和 Release Gate；R18 不擅自選 A 或 B、不改正式 Gate；只建立本離線 Machine Gate。
- AI-1 / Issue #2：以 R17 #123 真同版 SHA 為基線；Auth source/lease、撤權、刪除與 lawful provenance 的拒絕案例；Owner 自己修改 `modules/starry-id-v1/**`，不可寫 Billing/Battery。
- AI-2 / Issue #3：Billing 本域 inbox/tombstone/Store entitlements、防 PITR 恢復與合法 HMAC 授權缺口；Owner 修改 `packages/rebuild-billing/**`，不得創建 Auth 發布權威。
- AI-3 / Issue #4：Battery 本域持久收據、Law/policy 版本、獨立 Floor 缺件、Task/Wallet 中斷及災難恢復負測；Owner 修改 `packages/rebuild-ai3/**`，不得替 AI-4 做正式 Queue 發送。
- AI-4 / Issue #5：不啟用的跨域傳輸 / Outbox-Saga mock ports、partial fanout、Ack-after-commit 拒絕/ DLQ 模型；Owner 修改 `apps/api/**` 和自己有權文件，不開真 Queue、第二 Publisher、Staging 或任一 deployment。
- 以上專責均使用獨立 branch、一次整批 Git Tree/Commit、新的 Draft PR、新 HEAD Actions、回寫自己 Issue/#1；不重做 #113～#123，新的 Owner 改動才進下輪整合。

## 離線 Gate 與不得越界範圍
- 本檔配套 `docs/operations/r18-cross-d1-assignments.v0.json` 與 `verify-r18-cross-d1-preflight.mjs`、`packages/integration/test/r18-cross-d1-preflight.test.mjs` 具備**故意拒絕錯誤核准**的負測：假選定架構、Queue ACK=true、任何 live=true、錯綁專責、遺失風險案例、偽造 release approved 都必須失敗。
- 不建立 migration，不刪改任何專責 SQL，不建立空 API、token 或 Secrets；不修改 main / workflow／ruleset，不啟動 Cloudflare D1/R2/Queues、Apple/Google Store、EAS、任何付費服務。
- 只有在 **R18 AI-0 新 Draft CI 成功且 #1～#5 收到真 GitHub 指派記錄之後**，才向業主建議逐一或平行叫醒四位 AI。Issues 不會自動喚醒其他 ChatGPT。
