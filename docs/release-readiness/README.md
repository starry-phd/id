# AI-0｜Starry 上線與上架前置 Gate（2026-10-26）

**本文件已建立機器可讀的預檢清單，但**不**代表正式開發/雲端部署/商店上架已獲准。**

來源：Starry [AI-0 第四輪整合 Draft PR #46](https://github.com/starry-phd/id/pull/46) 固定 `bacc0166bf4e1070a4696c7bc109197b4c642f9f`，離線 Node 209/209、SQLite in-memory 69/69、同 SHA 12/12 CI 成功；[原始來源索引 PR #31](https://github.com/starry-phd/id/pull/31) 和第一波文件；最新 [DEV-I Google Docs](https://docs.google.com/document/d/1dsMcGBT5PO43aQVMhZOBO5uyNTE8QHYSnBmC4y2rMSI/edit) Expo/EAS 成本規則。

## 如何使用
- `release-readiness.v0.json` 是 **11 個 Gate 的現況與證據容器**，不是正式業主批准或部署權限。
- `node docs/release-readiness/check-release-readiness.mjs --assert-blocked`：驗證資料完整，並顯示 `release: BLOCKED`。**成功 CI 只表示「封鎖政策按設計正確」，不代表可發布。**
- 每個 Gate 的證據、負責人、核准紀錄都需被真實驗證；不得把模擬測試、假金鑰、離線 D1/Queue Ports、Draft PR 或未經業主審核的文件視為正式核准。
- 即使未來所有 Gate 變為 verified，仍需業主獨立授權、受保護 GitHub Environment/Cloudflare 審查，才能考慮任何 Deploy。**本方案永遠不提供自動部署能力**。
- 沒有連接 Cloudflare、Apple/Google 真實帳號、上傳憑證、啟用 EAS Build/Update、創建付費 D1/Queue、合併 main 的動作。

## 預檢清單（目前全部 BLOCKED）
| Gate | Owner | 需證實 |
| --- | --- | --- |
| G00-SSOT | AI-0 | 核准 MVP 範圍和需求溯源 |
| G01-ISOLATION | AI-0 | 雙品牌資源及帳號隔離 |
| G02-OIDC | AI-1 | Apple/Google 真實登入與憑證 |
| G03-SESSION-D1 | AI-1 | Session/會員 D1 持久化與撤權 |
| G04-STORE | AI-2 | Apple/Google 商店權威驗證 |
| G05-BILLING-D1 | AI-2 | Billing D1 原子交易及權益 |
| G06-P05 | AI-0 | 單一正式 P05 事件契約 |
| G07-AUDIT-QUEUE | AI-3 | 稽核 D1、Queues 與 DLQ 回復 |
| G08-WORKER-SDK | AI-4 | 正式 Worker/SDK/Expo 路由 |
| G09-DEVICES | AI-4 | iOS/Android/Web 原生商店驗收 |
| G10-OPS | AI-0 | 營運、資料復原及稽核管理 |

## 路線圖和明確界線
1. **先定 MVP / Gate0**：完整原始 128 項 source headings 與新版 25 seed 的 traceability、核准/排除/取代決議，不自動將舊功能變成核准。
2. **真實受控 Staging 前審核**：OAuth callbacks / JWKS、受控 Secrets/D1 migrations/備份、Billing Store official trust/Sandbox 真交易、P05 事件正式版本、稽核 Queue + DLQ 可靠性。屬下一階段 **擬議**，非本回合執行。
3. **必要原生測試**：只在原生變更/關鍵登入內購推播/提交商店時編譯；GitHub 每 PR 保留必要免費 CI，遵守 DEV-I EAS Free、記錄帳單來源與使用額度；不因成本省略 iOS/Android 實機驗收。
4. **最終獨立核准**：核對每個 Gate 的真實 evidence URL / commit SHA / 驗收 reviewer 及簽名；此工具不驗證遠端證據真偽、核准者身分或第三方商店狀態。人工確認前**一律封鎖**。

## 風險優先序
- Critical：未審需求、真實 Auth/金鑰、付款權威、D1 原子寫入、P05 未核准、Queue/稽核完整性、跨品牌隔離。
- High：EAS iOS/Android 必需的原生/商店測試、資料復原/隱私／權限、Cloudflare 和 Store 成本/限額。
- 「第四輪離線測試成功」**不**是 Store、Cloudflare/Production 安全性的有效替代。

**提醒：** 防線的真實有效性還取決於 Repo 權限、部署密鑰和 Cloudflare 帳號權限；獨立 PR 裡的 policy CI 不能阻止有實際部署憑證權限的人繞過它。任何真實操作應先核准環境保護及最小權限。
