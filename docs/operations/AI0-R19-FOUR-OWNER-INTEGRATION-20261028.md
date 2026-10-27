# AI-0｜R19 四位專責原始 Blob 真整合／離線 Gate

> 2026-10-28 台灣時間。**此文件是 Draft 原始碼同版整合的追溯，不是跨 D1 官方原子性、正式發佈或 App 上架證明。**

## Baseline 與程序
- [R18 最新四組離線整合 #131](https://github.com/starry-phd/id/pull/131) `f006e90311b3fecedae0f7c75004c940adfacede`，先前於同一 checkout Node 899／SQLite 254；保留已核 R18 歷史。
- [AI-0 Consumer-A UX 候選 #136](https://github.com/starry-phd/id/pull/136) `84a5b8c4995f24a5c693100a0987273905c07d1f`，同版 Node 905／SQLite 254；這只新增 **紙面 App 產品規格**，並沒有選定或建好正式 App。
- R19 Owner 四組分別以 #131 `f006e90311b3fecedae0f7c75004c940adfacede` 為底，保持專責內文件新增，**AI-0 本次直接採用四組 R19 最新實際 PR 原始 Git Blob SHA，不是從四組不同 Head 分別宣稱整合成功**：
  - AI-1 [#132](https://github.com/starry-phd/id/pull/132) `de2d4201bf4cf76b0db424fecc73f6bbb15524a9` — 3 個 Auth-only 新檔。Owner CI 2/2 成功。
  - AI-2 [#135](https://github.com/starry-phd/id/pull/135) `df6f49a84a89d8f0c0dde57463bfad6cb091323d` — 3 個 Billing-only 新檔。Owner CI 2/2 成功。
  - AI-3 [#133](https://github.com/starry-phd/id/pull/133) `9ba8a24b670c202de30a72676b7579a402260bd7` — 4 個 Battery/Task-only 新檔。Owner CI 1/1 成功。
  - AI-4 [#134](https://github.com/starry-phd/id/pull/134) `48f234ee252dc027c00ef0e692682649b32cfbd5` — 4 個 API/Private Saga-owned 新檔。Owner CI 1/1 成功。
- AI-0 新 branch：基於 #136，**一次整批 Git Tree + Commit**，匯入 14 個未更動的原始 Owner blobs ＋ AI-0 獨立原始碼完整性/整合驗收文件四份；不改另外四位原碼、環境或開放 Worker API，不重做 R18，不修改 main。
- 原始 SHA 完整清單：`docs/operations/r19-owner-original-blob-manifest.v0.json`；本次 CI 同版 `docs/operations/verify-r19-owner-blob-integration.mjs` 真實重新計算每個檔案 Git blob SHA-1，不容許只看檔名或只取 PR metadata；Node 負測位於 `packages/integration/test/r19-owner-exact-blobs.test.mjs`。

## R19 跨模組的實際內容與仍未完成
| Owner | 真正離線程式候選 | 仍未滿足的真平台／跨域驗收 |
|---|---|---|
| AI-1 | Auth 已提交刪帳、Session 撤權、Lease/合法留存來源 DTO，真 sqlite 來源負測 | 沒有正式 P05 portable signed publisher、KMS/HMAC/Q104-Q119 完整法遵、跨 D1 真源權威 |
| AI-2 | Billing 唯讀 Saga 收據、退款/撤權、本地 Tombstone/PITR 離線讀回 | Store 官方收據、正式 Store/Billing D1、KMS/不可回退 witness，不能發行 Queue ACK |
| AI-3 | 多獨立 SQLite 中 Task–Wallet 已提交、持久收據、拒絕錯配和復原 | 跨 D1 物理一致、正式事件/收據簽章、真 Task 容錯及安全恢復，免費 Battery 絕不可購買 |
| AI-4 | 私有 R18 Saga 在多庫可執行測試、含真 R18 Owner adapter 負測；重送/部分成功/ACK/DLQ 拒絕 | 最新 R19 Owner DTO 之間不必然完全正向接通；真外部 KMS/Queue/Store/D1 仍缺。不能因本次 all-green 宣稱端對端完成 |

> **重要**：即使新同版 CI PASS，現有跨庫測試是 **多個 disposable SQLite / offline mock**，而非在 Cloudflare 上跨 D1 實際原子提交，也沒有真 Queue ACK、獨立不可回滾 floor；AI-4 也明確聲明 Billing 真正式來源仍缺。因此上線與跨庫權益更新 **fail closed**。

## 唯一有意義的整合判定
1. **四位 Owner 最新來源真 SHA + 14 個 exact git blobs**，0 重疊、0 AI-0 修改原始檔。
2. **新整合 HEAD** GitHub Actions 全部 `completed/success`；完整 same checkout 測試含四位 TS/lint、Node API/跨模組負測、多 SQLite Python、128 來源、官方 G00～G10 `--assert-blocked`、Dev Expo/Workers dry-run。
3. 統合 Gate PASS 只標記 `R19_FOUR_OWNER_OFFLINE_SAME_CHECKOUT_VERIFIED`，如果其中任一失敗就阻擋，不得假借各 owner 原先綠燈。完整證據待此 PR 的**最新 head SHA**／GitHub Actions 日誌補入。
4. **不合併**、不 Preview/Staging/Production、真 D1/Queue/PITR、Store/OIDC/EAS/Secrets、付費、H-Global。所有 G00～G10 11/11 BLOCKED，P05/PUBLISHABLE=false。
