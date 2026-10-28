# AI-0｜SBASE-20261028 四專責＋AI-0 候選基座原始碼同版整合

**完整來源：** [SBASE GitHub 總控 Issue #156](https://github.com/starry-phd/id/issues/156)、[原始技術文件 v1.0 候選](https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ)。本次全部**僅候選+離線**，沒有 App 或中央會員正式部署／付費／上架授權。

## 原始 Git Blob 全程不重寫

- 基底 [AI-0 中央 R21 整合 #148](https://github.com/starry-phd/id/pull/148) 固定 SHA `fbd5c03156da700b68c7b5bceb65269cb7c900ec`，保留既有中央 Auth/Session/Billing/Battery 的離線研究與安全負測，而**不採用已關閉的外部 App R22 PR #149～#155**。
- **AI-1 [PR #160](https://github.com/starry-phd/id/pull/160)** `18c74c63bc52e503f8a28d0eadb0fc08f4fefd0b`，原生 3 個 Git blob 完全不修改；四組 PR 各自已在固定 HEAD Actions completed/success。
- **AI-2 [PR #159](https://github.com/starry-phd/id/pull/159)** `7ee1998c6e90acde706d26197e785c1f25e96e39`，原生 3 個 Git blob 完全不修改；四組 PR 各自已在固定 HEAD Actions completed/success。
- **AI-3 [PR #161](https://github.com/starry-phd/id/pull/161)** `988ec91696ad93ac5eea7be9d74215c964e50d3f`，原生 4 個 Git blob 完全不修改；四組 PR 各自已在固定 HEAD Actions completed/success。
- **AI-4 [PR #162](https://github.com/starry-phd/id/pull/162)** `a80493c96594274fc980be510d389b05ffd3e828`，原生 3 個 Git blob 完全不修改；四組 PR 各自已在固定 HEAD Actions completed/success。
- **AI-0 技術審查 Draft #157** `a2997e941335dc266ae5dac11a8f6d811a2ba48e` 兩個原始 docs/architecture blobs；**未來產品規劃 Draft #163** `9a7add839445ed251114103cd43fa898a854ddde` 三個 docs/portfolio blobs。兩者原從舊 main 作產品規劃，今以**原始 5 Git blobs**導入最新中央 R21 開發程式基準，解決兩條 source ancestry 分岔，並**不 merge 舊 main**。
- 全部 18 個來源檔案由 Git Tree 直接引用**確切 Git Blob SHA**，沒有把 Owner 的 GitHub 程式內容重新生成；額外新增 AI-0 Interop 1 個 Node 測試和 2 個整合證據 docs，不改既有 Owner source/SQL migration/package/Worker/main。

## 此輪跨界整合測試焦點

- AI-1 `AuthClient` 保持 Guest/Session/刪帳只讀、未驗證 Auth 絕不核發私有權限。
- AI-2 `BillingClient` 沒官方 Apple/Google/RevenueCat 的可信交易權威時，買斷、訂閱、去廣告、退款恢復永不自動發權；免費 Battery 不得被當商品。
- AI-3 `BatteryClient` 只可候選讀取免費政策，沒有餘額、扣抵、購買或 Queue ACK 授權。
- AI-4 `AppFactory` 只建立 manifest 提案，不創 Repo/App/真 Store ID，所有 Ad/Build/Production 旗標 OFF；將前面三個真 Owner 的**離線端口結果**接到 inspectSbaseClientPorts 時，也不得得到正式權限。
- **新增同版 Gate 測試**：`packages/integration/test/sbase-four-owner-interop.test.mjs` 對所有實際來源模組執行 version/scope/失效保守處理與跨模組只讀互通，不允許用各 Owner 獨立 green 取代整合 green。

## 技術決策／正式發布必須誠實標記

- Expo SDK58/RN0.88、Hono/Zod/OpenAPI codegen、pnpm/Turbo、RevenueCat、AdMob/UMP/ATT、Sentry/原生 Development Builds 都是**候選／待 PoC**，現有中央 mobile 仍 Expo54/RN0.81.5。
- 目前 GitHub `starry-phd/id` 為**公開 Repo**，新 private 多 App Monorepo 候選需要單獨 ADR/權限批准；不把私有新 App 放進 public repo。
- 既有中央服務正式 `G00–G10 11/11 BLOCKED`，P05/PUBLISHABLE false，真 Cloudflare D1/Queue、實體跨 D1 A/B、OIDC/JWKS、法遵／外部不可回退證據、正式 Store/EAS 皆待真驗證。
- 此 Draft 不 merge main，不改正式 D1/Worker/商品/Secrets/H-Global，不觸外部個別具名 App。

## 關於效率與後續

只跑現有的**完整同 HEAD GitHub CI**（真 TS/lint、Node、SQLite、source manifests、Expo/Workers DRY-RUN、release blocked assertions）及極少量必要跨模組互通；不發起額外重複 Owner 工作，不新增付費服務。此次成果完成後在 Issue #156 與 #1～#5 GitHub-only 通知。
