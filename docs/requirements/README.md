# Rebuild｜需求唯一登記與決議追溯

**2026-10-26 第一輪規格基座**，非已完成第一波全部功能或已上線的證明。

- `registry.v0.json` 現在僅有 25 項**架構與爭議種子紀錄**，`coverage=seed_only`；原始第一波 108/130 之間的差異仍需全面對照，不能宣稱已盤點完畢，未收錄也不能當作刪除。
- **兩套獨立會員服務必須明列**：`ID-S-001` Starry ID (Starry App 共用)；`ID-H-001` H-Global ID (H-Global App 共用)；禁止共享正式帳號、Session、D1、管理員授權。
- 狀態 `approved/candidate/deferred/rejected/superseded` 與開發進度 `not_started/draft/ci_verified/merged/deployed` 各自獨立。
- `candidate` 不得實作為真實業務功能，設計 ADR／POC 不代表核准。
- 每次變更需 PR、明確決議來源與 AI-0 Gate；交接包 Google Docs 作原始依據，非可自行同步的第二份真相。
- 原始需求：[主交接包](https://docs.google.com/document/d/1o9luZIfaeMVBVT5XWD4fSiFHtG3F-viqNbsjmtoq_Cw/edit)、[第一波 DEV-A～DEV-I](https://drive.google.com/drive/folders/15EasmJ2bLd61Bmt_xQ3Ll7PVNzIlvemR)。
- 驗證命令：`node docs/requirements/validate.mjs`。

## 接下來
1. AI-0 逐項盤點所有原始功能 ID、衝突、版本、核准依據與 owner，證實完整 coverage 才可關閉 Gate 0。
2. AI-1：真正 Starry ID Member/Auth/Profile 作第一條垂直切片；H-Global 保留獨立契約但不在本 Repo 實作。
3. AI-2：訂閱/IAP 方案 ADR 和 sandbox security test。
4. AI-3：稽核與可靠事件；Battery 業務只保留免費/Starry-only 安全邊界。
5. AI-4：可重現 Expo/Workers monorepo、OpenAPI POC、CI、單一受控 Git 提交策略。

現有 Draft PR #19～#24 為歷史候選，不可視為新架構已經 Gate 驗收；不強制沿用，亦不任意刪除或合併。
