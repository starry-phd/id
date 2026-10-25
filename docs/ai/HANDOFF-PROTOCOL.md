# Starry ID｜AI-0～AI-4 GitHub 唯一交接與協調協定
> Owner: `starry-phd` · Repo: `starry-phd/id` · Status: decision recorded, agent execution not auto-triggered.
> 本文件為 2026-10-26 業主最新決議；與舊交接方式衝突時，以本文件的「GitHub 交接」與「H-Global 暫停」限制優先。

## A. 最高優先決議
1. **五組 AI（AI-0、AI-1、AI-2、AI-3、AI-4）所有工程任務、疑問、決策、交接、測試證據、阻塞與驗收，均在此 GitHub Repo 進行。** 不要求業主在五組聊天之間複製／轉貼交接內容。
2. 目前**只有 Starry ID / Starry 生態系範圍准許開發**；**H-Global1985 所有實作、雲端資源、會員資料庫、登入、API 服務、部署、GitHub Repo 操作一律暫停**，除非有新的明確業主決議解除暫停。
3. **預留未來 Starry 與 H-Global 會員基本資料 API 串接介面**，僅限 Starry 端不啟用的契約、抽象層或 mock；不建立 H-Global 後端、不寫 H-Global D1、不互傳真實會員資料。
4. GitHub Repo Public；只放非機密文檔與程式。嚴禁 secrets、正式會員資料、正式環境憑證。

## B. GitHub 作為唯一工作交接通道
- **規範**：`AGENTS.md`、`docs/ai/HANDOFF-PROTOCOL.md`、`docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md`。
- **任務分配／規格問題／決策紀錄**：GitHub Issues（AI-0: #1；AI-1: #2；AI-2: #3；AI-3: #4；AI-4: #5；跨品牌預留介面：見專題 Issue）。
- **程式變更、審閱、CI、測試及 SHA**：以各自 Branch／Draft PR 作為可稽核紀錄；PR 必須關聯 Issue。
- **跨組交接**：在原 Issue/PR 寫明依賴的下游 Issue/PR，並在下游 Issue 寫一則交接摘要，提供固定 URL、commit SHA、介面版本、驗收證據及下一步；禁止只說「我已告訴使用者」。
- **決策衝突**：由 AI-0 在 #1 記錄裁決與決策依據，必要時更新正式契約文件；不能只靠聊天內容改變工程事實。
- **狀態及真相來源**：每個專責 Issue 必須更新狀態；`planning / blocked / ready / in progress / draft PR / CI verified / awaiting gate / merged / deployed` 必須跟 GitHub 證據一致，不得把規劃當完成。
- **不要通知業主幫忙代傳**；若遇權限、收費、Production 發布等需批准情況，AI-0 可請業主作決策，但實際工程交接仍透過 GitHub 紀錄。

### 交接留言必備欄位
```markdown
## HANDOFF: AI-X → AI-Y
- Issue: #...
- 目前狀態: planning | blocked | ready | in progress | draft PR | CI verified | awaiting gate
- 交接目的／範圍:
- 契約版本／變更:
- 分支與 Commit SHA:
- Draft PR:
- 驗證指令、CI run URL 與結果:
- 依賴／阻塞:
- 接手 AI 下一步操作:
- 是否需要 AI-0 Gate 決策:
- 確認無 H-Global 實作、無正式資料、無 Secrets:
```

## C. 預留跨品牌 API 的範圍
- 以 `docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md` 為**預留設計文檔**；未核准的「同步欄位清單」「真正 URL」「最終 OAuth/scopes」不得推定已決議。
- 獨立 Starry `s_user_id` 與獨立未來 H-Global `h_user_id`；不共用 Auth／Session／D1／金流／Secrets，不因相同 Email／姓名自動合併。
- 僅在未來 **雙系運行、兩邊身份驗證、本人授權與指定欄位清單核准** 後，才允許透過受保護的 HTTPS API／版本化契約交換指定基本欄位；需支援撤銷、稽核、錯誤/衝突處理與最小權限。
- **預設功能旗標關閉**（設計名稱 `CROSS_BRAND_MEMBER_SYNC_ENABLED=false`，此時只是規格慣例，非已部署環境變數）；沒有 H-Global 側可用服務時採 fail-closed，不模擬為已連通。
- 尚未實作的 API 不得在 README／進度報告宣稱「串接已完成」。

## D. 執行限制
- 此 Repo 裡建立 Issue、寫入規範**不會自動啟動五個獨立 AI 執行緒**。要真的平行開發，仍需各個有 GitHub 存取權的 Codex／Agent 執行環境讀取自己的 Issue，持續依授權事件執行與回寫。
- AI-0 要統籌，但沒有實際可運作的跨 Agent dispatcher／排程／持續執行環境前，不能承諾無人觸發時自動工作。
- 遵守 GitHub AI API 安全 SOP：序列化寫入、去重、保守限流、只用需要的資源權限；無高頻 polling 或重複 CI。
- 無 AI-0 驗收及業主發布授權，不合併 main、不動 Production／正式 D1／真實付款；文檔規範初始化之例外限本次批准的規劃寫入。

## E. 第一輪 Gate
- [x] AI-0～4 GitHub Issues 建立
- [x] GitHub-only handoff 決議寫入 repo
- [ ] 驗證四組 AI 的執行環境是否真的綁定此 Repo 並能讀寫 Issue／PR
- [ ] 認定已核准的 Starry ID 功能規格及跨品牌預留欄位待決清單
- [ ] AI-1／AI-4 設計並提交預留契約；AI-0 Gate 1 審閱
- [ ] 各組實際 Draft PR 與 CI 檢查
