# AI-0｜R18 四位 Owner 原始 Git Blob 同版整合（離線 Gate）

> Draft-only / 2026-10-27 / **R18 不等於真 Cloudflare 跨 D1 原子提交、同版測試也不是發布批准**。

## 可追溯來源
- 本次整合前已在同 SHA 通過 CI 的基礎：AI-0 [R17 真四組整合 #123](https://github.com/starry-phd/id/pull/123) `f84eab58e20377b5bd1ce313b969befb531b4938` → [R18 決策前置 #124](https://github.com/starry-phd/id/pull/124) `ca5fc5185eae5f864b806b55b0b1ef6daee1f420` → [未來 App 規劃 #130](https://github.com/starry-phd/id/pull/130) `b858da39c28541f1325606807b23ed5394b817d8`。
- **本次親自核實 GitHub latest Owner Draft + exact files/blob**（所有 PR base 均為真 R17 #123；不把 PR #124/#130 已繼承內容重匯入）：
  - AI-1 Auth [#127](https://github.com/starry-phd/id/pull/127) `251150155421b5c13702efe4c6ee4b0a4f30bcc8`：4 個 Owner-only blobs；2/2 same SHA Actions success [full #40522075728](https://github.com/starry-phd/id/actions/runs/40522075728)。
  - AI-2 Billing [#126](https://github.com/starry-phd/id/pull/126) `5ea5238154647a85e68141a133166c78aed054b9`：3 個 Owner-only blobs；2/2 same SHA Actions success [full #40521739728](https://github.com/starry-phd/id/actions/runs/40521739728)。
  - AI-3 Battery [#128](https://github.com/starry-phd/id/pull/128) `cbaf08c91725f987edb4d928b8910849182b0f97`：4 個 Owner-only blobs；1/1 same SHA Actions success [full #40522282770](https://github.com/starry-phd/id/actions/runs/40522282770)。
  - AI-4 Saga/API [#129](https://github.com/starry-phd/id/pull/129) `2a938031f179b0d390ca7d3eafa5362a87946510`：3 個 Owner-only blobs；1/1 same SHA Actions success [full #40522219938](https://github.com/starry-phd/id/actions/runs/40522219938)。

## 真整合程序與安全驗收
1. AI-0 新 branch 從 **#130 latest HEAD** 建立（保留 #124/#130 AI-0 files 但不要引入任何重複 R17 文件）。
2. **一個 Git Tree + 一個 Git Commit** 匯入四個 R18 Owner PR 當時完整檔案 blob SHA：總數 14，零路徑衝突、不重寫 Owner source/test/SQL migration。再新增 AI-0 三個獨立離線驗收檔（本文件、manifest、Git Blob verifier、Node tests；實際共 4 個 AI0-only 檔）。
3. `docs/operations/r18-exact-owner-blob-integration.v0.json` 記載固定 Owner PR/head/14 原始 Git blob sha；`docs/operations/verify-r18-owner-blob-integration.mjs` 直接用 Git blob SHA-1 byte-level 驗證 **same-checkout 14/14**，另驗證官方 11 Gate blocked、拒造實體批准。新 Node 負測由現有 `packages/integration/test/*.test.mjs` Gate 自動執行。
4. 整合 **新 HEAD** 後必須在 GitHub Actions 看到全版 `completed/success`，Node 四模組 + AI0 preflight、SQLite memory、TS/Lint、128 SSOT、Expo/Workers dry-run、11 blocked Gate；成功數必須由該 HEAD 之 job logs 計算。**不得拿四位 Owner 個別綠燈當作整合成功**。失敗時只能補真正同版整合問題/新增 AI-0 test，Owner 程式須回各專責修正。
5. 最終回寫 PR Body、AI-0 Issue #1 和四 Owner Issues #2～#5，留真固定 SHA、動態 CI links、尚未解的正式風險／下輪優先事項。

## 不可更改的保護邊界
- #87 跨 D1 單一交易權威 A 或 Outbox/Saga B **尚未由業主選定**；所有 R18 都是離線候選；AI-1 Auth 是**唯一邏輯出庫來源**，不是已核可真 KMS/Queue Publisher。
- AI-2 付費權益和 AI-3 永久免費 Battery **不交換**；R18 只有 mocked Store/RSA/independent witness。
- Q104/Q119 lawful HMAC/retention、P05 唯一正式 event schema、可回退外部 floor、真 D1/Queue/DLQ ACK、真正 App MVP/Store/EAS/成本全部仍缺 owner/平台批准。
- **G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false。** 不合併 main、Preview/Staging/Production、真 DB/R2/Queues、Secrets/OAuth/Store/EAS/付款、付費；H-Global 全停。
