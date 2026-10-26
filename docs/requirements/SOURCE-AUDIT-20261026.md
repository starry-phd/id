# AI-0｜第一波來源編號盤點：108 + 10 + 10

2026-10-26，源自業主提供的 [第一波《開發清單交接包》](https://docs.google.com/document/d/1o9luZIfaeMVBVT5XWD4fSiFHtG3F-viqNbsjmtoq_Cw/edit) 主文件。此為 **來源索引**，不是新案已核准規格，也不是重新啟動已完成的證明。

## 已完成的可核對盤點
- 主文件中有 **108** 個 `01.01–12.06` 類型的逐項舊功能標題。
- 有 **10** 個 P01–P10 管理 API / ADMIN-PREP 預留標題。
- 有 **10** 個 N01–N10 新案架構規則標題。
- 共 **128** 個獨立標題 ID（非 128 個已核准功能）。其精確標題與 ID 已存 `original-inventory.v0.json`。
- 與先前提出的 **130** 項說法不同；130 的來源、是否包括另外新增項目，仍未證實。**不得將原 108、P10、N10 與新架構 Seed 25 相加當成正式新功能總數**。
- 現有 `registry.v0.json` 的 **25 項**是新架構種子/待決項，它有獨立的核准狀態；`coverage=seed_only` 正確維持，不能自動將本來源清單全部改成 approved、deleted 或 deployed。
- 主文件的標題並不能代替每項完整限制及紅字衝突說明；Google Docs 舊文字、紅字、審閱欄位及各 DEV 文件仍需逐項核對。

## 正在等待的第二階段來源 reconciliation
1. 對照 [DEV-A～DEV-I 原文件](https://drive.google.com/drive/folders/15EasmJ2bLd61Bmt_xQ3Ll7PVNzIlvemR)，逐項核對完整原文、業主審核狀態、紅字衝突、取代關係、品牌歸屬與可靠的決議時間。
2. 建立 `source-id → canonical-feature-id` traceability，允許多對一、1 對多；若缺明確決議，僅標 candidate/unreviewed，不默認同意。
3. 已知需要本人決策的產品爭議：Starry Battery 是免費週期配額或免費餘額錢包？Starry 旗艦 App 精確清單及上架數？H-Global 的教育中心與獎銜是否在新案採納？Billing 真實 IAP 自建或託管？跨品牌同步具體欄位及資料權威？
4. Gate 0 在 complete traceability 和核准範圍確定前仍 BLOCKED。請各 Owner 不要用來源索引直接實作未核准業務。

## CI 與 Owner 界線
`node docs/requirements/verify-original-inventory.mjs` 驗證 ID 唯一及 108/10/10 數量，不改動 AI-1～4 的實作及 PR。這只驗證索引數量，不驗證完整業務語意。
