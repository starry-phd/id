# ADR-0001｜H-Global × Starry：新架構正式重啟

- 日期：2026-10-26
- 決議：**使用者已核准重設整體工程架構，五個 AI 分工正式啟動 Starry 新版 Phase 0**。
- 實作狀態：**本 PR 是規格與安全基礎候選，尚未 Gate 0/1 完成、未合併 main、未部署**。

## 正式架構

1. **Starry 專屬 Starry ID 會員服務**：獨立 Apple/Google 登入、會員主檔/個人檔案、Session、身分驗權及同品牌 App 共用 ID；**H-Global 專屬 H-Global ID 會員服務**完全分離。兩系不可共享正式資料庫/授權/Secrets/付款。
2. 保留 React Native + Expo + Expo Router + TypeScript，Workers + D1/R2/Queues 按需使用；統一 OpenAPI 接口與測試。Hono/Zod 為候選，不在此 ADR 預斷廠商與套件。
3. D1 **領域邏輯隔離＋唯一寫入者**；實體 D1 拆分數量依交易同庫原子性、安全、負載決定，不能直接寫死 2 或 6 庫。
4. 熱門票券/QR 或未來獲核准的有餘額 Battery 狀態，先透過 ADR/壓測決定 Durable Objects 或 D1 原子條件寫入，注意跨 DO↔D1 補償與崩潰一致性。
5. 避免 30–50 款近似 App 獨立上架；優先少數旗艦 App/功能模組，最終包數需產品決議。
6. 第一個 Starry MVP 垂直切片先驗可信登入 → Starry 會員資料 → 必要安全管理/刪帳 → 單一正式核准功能 → Sandbox IAP/權益 → Audit；各步要真實契約與端對端證據。
7. Battery **永久免費且僅 Starry**；配額/錢包、預留/FEFO/負數等業務尚待決議，禁止未核准建帳本。
8. 跨品牌會員同步預設關閉，須明確的雙邊驗證與同意、逐欄資料權威/撤銷/版本衝突規則；不因同 Email 合併。
9. GitHub 規格 registry 是唯一核准狀態 SSOT，Google Docs 原始交接包必須維持完整追溯；缺頁/紅字/空白勾選皆視為候選待決，不可假定核准。
10. **五個 AI 分工**：AI-0 SSOT/Gate/ADR；AI-1 Starry ID 會員/Auth/Profile；AI-2 Billing/IAP；AI-3 Trust/Audit/免費 Battery 設計；AI-4 Expo/Workers/OpenAPI/CI。先採已可用的 GitHub 安全 Draft PR 工作流，後續計畫移到雲端單一 Monorepo＋單一 Git 提交入口。新雲端工作站尚未選定，不能假稱已建置；不引入未核准費用。

## 安全與開發界線
- `starry-phd/id` 只開發 Starry 新版；H-Global 獨立架構可被規劃，但**不授權在本 Repo 部署或寫 H-Global 實體 App**。
- 現有 Draft PR #19～#24 視為歷史候選，可依新規格檢視是否可重用；不能自動移入 main 或自動宣稱完成。
- 不操作 Production/正式 D1/Secrets/真實金流/Apple 或 Google 正式商店/域名，不刪除現有服務。
- 之後每一個重大分歧（IAP 自建或託管、DO 資料一致性、Battery 產品用途、旗艦數量、跨品牌同步欄位與雲端開發供應商）必須各有獨立 ADR 和業主決議。
