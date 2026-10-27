# AI-0｜Starry 未來 App 產品組合、首款 MVP 與上架前置路線圖 v0.1
> **2026-10-27｜僅候選產品規劃／尚未獲業主選定｜不可自動開發或發布。**

GitHub SSOT：[未來 App 專責 Issue #125](https://github.com/starry-phd/id/issues/125)、[AI-0 總控 #1](https://github.com/starry-phd/id/issues/1)、[R17 四 Owner 真同版離線整合 #123](https://github.com/starry-phd/id/pull/123) `f84eab58e20377b5bd1ce313b969befb531b4938`、[R18 AI-0 前置 Gate #124](https://github.com/starry-phd/id/pull/124) `ca5fc5185eae5f864b806b55b0b1ef6daee1f420`。
規格來源：`docs/requirements/AI0-R8-HIGH-PRIORITY-CONFLICTS-20261027.md`、`docs/requirements/README.md`、`packages/rebuild-ai3/docs/ROUND7-FREE-BATTERY-APPROVED-DECISIONS.md`、`docs/contracts/FUTURE-STARRY-ADMIN-API.md`、`apps/mobile/test/no-standalone-store-app.test.mjs`。

## 一、產品的正確層次：**共用服務 ≠ 可上架 App**

| 層級 | 候選或已存構件 | 現況 | 必須守住的邊界 |
|---|---|---|---|
| 共用身分底座 | **Starry ID** | 第一波 Starry 專用 Auth／會員服務（離線開發）；`apps/mobile` 的 `starry-id-dev` 為開發測試殼 | Q105：**不因現有 Expo Dev 殼就開一個 Starry ID 上架產品**。實際啟用真 Auth/OIDC 仍需 Gate |
| 第一款消費者 App | **Starry AI 任務型 App（代稱 Consumer-A）** | **AI-0 優先比較的候選，不是批准的新 App** | 應有可解釋的獨立用戶價值；消費可用免費 Battery，任務扣額必須依真實可信 AI Task 結果；商店識別、地區、名稱、功能與 X/Y 數值全部尚未批准 |
| 後續專用 App | **Starry 專題 AI 工具（代稱 Consumer-B）** | **長期候選，不能先建立空 App 或上架列表** | 視首款產品成功及實際需求再決定；共享 Starry ID，但各 App 有不同 `app_id`、任務/費率版本、授權和稽核 |
| 進階營收功能 | **選定 App 的正式數位訂閱／IAP** | AI-2 只有候選離線 Store/Billing 契約；**沒有已核准 SKU/價格** | 必須經 Apple/Google 官方產品規則與獨立 Billing Store 權威；**免費 Battery 永久免費，不得購買、儲值、出售或與付費 SKU 轉換** |
| 管理面 | **Starry 專用中央管理中心（Wave 2）** | P01–P10 接入準備；60-capability/UI 僅長期願景 | 第一波不啟動第二波 Admin UI；`admin.starry.phd` 僅候選域名，與 H-Global Admin 絕不共用實體權限/DB |
| 暫停品牌 | **H-Global** | **本 Repo 不做** | 未來恢復須獨立 SSOT/資源、正式批准；Starry 不同步 H-Global 會員原欄位或跨品牌 token |

> 過去 DEV-I 舊清單提及 `starry-echo` 等 App 名稱，但已被 Q105 更新規則重新界定：**舊名稱不是正式首款 App 的核准紀錄**。這裡不替業主啟動任何舊產品。

## 二、首款 App 候選比較（不宣稱業主決定）

| 類別 | 解決的用戶問題（需市場驗證） | 依賴現有工程 | 初期產品風險 | AI-0 評估 |
|---|---|---|---|---|
| **A：AI 任務型消費者 App** | 用戶有一個明確 AI 工作可以開始、查看結果、看懂免費電池消耗 | Auth、Task、Battery、通知、刪帳、App/Env Registry；可不在 MVP 開正式 IAP | 真 Task success authority、合法首贈、防止扣額、任務 UX，皆尚需實證 | **可優先做紙面與離線 UX 原型研究**；**不是選定首款** |
| **B：專門用途 AI 工具 App** | 針對一種場景提供可衡量的效果；需業主指定場景與目標人群 | Starry ID、SDK、Task/Battery；可能額外敏感資料與合規 | 功能需求尚不明，可能增加 Store 審核與內容處理成本 | 維持候選，不自行寫新核心功能 |
| **C：先做「Starry ID App」本身** | 用戶只註冊/登入/管理帳號，沒有獨立消費功能 | 已有 Dev Expo 殼 | 與 Q105「ID 只是共用服務」衝突、價值不清楚 | **不採用作首款上架方案；保留 Dev harness** |

**建議研究順序（不是核准）**：先讓業主選一個具體的 AI 任務和目標族群，再用 **A** 驗證 1 個主要工作流程是否有價值；若其實用戶偏好某個專用垂直工具則評估 **B**。**不能從技術已存在倒推市場需求已驗證。**

## 三、首款 AI 任務 App 的最小可理解 MVP（全部需產品核准）

1. **價值入口**：說清楚「可完成什麼任務」及必要內容示例；不能僅以登入頁充當產品。若任務需要外部 AI 供應商，需額外審核資料去向、成本與安全。
2. **Starry 身分流程**：會員可登入／查看最小資料、錯 Session/跨 App 越權必拒；Apple/Google 真 OIDC 仍 Gate blocked；若只需一般展示且不必登入，避免強迫無必要註冊。
3. **免費 Battery 顯示與解釋**：永久有效，註冊 X、首個合法任務 Y 由正式版控政策決定；顯示餘額、保留中／確認扣額／撤銷和交易歷史，不能顯示測試數字為正式值。
4. **任務核心**：先說明費率、確認必要授權，再依真正可信服務端策略 `reserve → trusted task commit → settle/release`；R18 跨 D1 不確定時只可 fail closed，不能先顯示成功可用額。
5. **任務取消／失敗**：時限、網路中斷、重播、雙擊、退款/返還免費額度均由單一可信來源和可回讀 receipt 控制；不把「前端 timeout」當真跨庫 rollback。
6. **必要通知、歷史、申訴**：僅最小任務狀態、失敗與被拒理由；隱私資料最小化，申訴/復原/安全稽核按合法保留與權限處理。
7. **資料主體權利與刪帳**：提供清楚的 App 內刪除入口以及 Android/Google Play 需要的外部 Web 刪除資源；訂閱撤銷/取消的顯示與合法保留以平台/法規及實際業務核准為準。**真正帳號刪除跨服務 Fanout 仍是 R18 的離線工程，不等於已可服務真會員**。
8. **付費加值（非首期必備）**：只有業主正式選營收模型與商店權威後才列為 App MVP；付費權益獨立存於 Billing，絕不替代/販賣免費 Battery。

**明確不在現在 MVP 的項目**：未選定的獎勵/社群/活動/付費套餐、H-Global 資料共享、廣告 SDK、第二波完整管理中心、真推播/Store/SKU、正式 AI 供應商付費呼叫。

## 四、分階段產品開發／上架規劃（順序建議，不承諾日期）

| 階段 | 交付標的 | 可現在安全完成 | 不可冒稱的狀態／下一個 Gate |
|---|---|---|---|
| **F0｜決策與使用者驗證** | 1 份比較矩陣、選定目標使用者、1 個實際 AI 任務的 UX 假資料原型與優先級 | GitHub 文書/純本地 mock，用戶訪談問題、資料流分析 | **產品尚未選定**；G00 不解鎖 |
| **F1｜共享平台離線垂直切片** | Auth→Task→Free Battery→receipt→通知/刪帳完整可測鏈；Owner 分離與權限清單 | 四位 Owner 在 R18 各自實作，AI-0 之後做真正同 SHA 整合 | R18 Owner CI 尚非整合；G03/G06/G07 仍 blocked |
| **F2｜首款 App 契約與體驗候選** | 消費者 App 的 AppRegistry 草案、畫面資訊架構、SDK+OpenAPI 契約、拒絕路徑、無費用裝置測試計畫 | 先做文件/Mock 與 UI 狀態表，不建立上架身份、不建正式產品檔 | 需 G00 首款 App 核准 + G01 隔離及 G08 合約審查 |
| **F3｜經批准的受控 Staging／商店沙盒** | 官方 OIDC、真 D1/Queue/Store（如選 IAP）、iOS/Android 真機／可回復演練 | 事先寫核准單、成本上限、真帳號保護、測試資料刪除與退出計畫 | **只有獲另外的明確業主授權後才能做**；不因本路線圖授權。G02–G09 待正式證據 |
| **F4｜發布決策與多 App 擴展** | 完整 G00–G10 及法遵/成本/稽核/恢復證據、人工審核，再評估 Consumer-B | 策略/指標與無授權時的 release-blocker 清單 | 11 Gate 真實逐項批准，且**另行**業主發布許可。Wave2 Admin 另案 |

## 五、手機 App 設計決策與程式分界（不侵入四 Owner R18）

**建議後續 App 層規格**：每個 Starry App 的 `app_id`、用途、platform、真 `bundleIdentifier/package`、env、Owner、API version、support/privacy/deletion URL 要由業主核定後記在 App Registry；第一個具名候選不得繼承 `phd.starry.id.dev` 直接用作正式商店身份。iOS / Android / Web 可考慮 React Native + Expo Router 的配置化 UI，**每款真正上架 App 都要各自對 Store 政策、隱私聲明、憑證和商品權益負責**；共用 Starry ID SDK 不等於共用 App 品牌授權或訂閱購買範圍。

**第二波獨立管理中心**：保留 P01 App registry、P02 API/SDK、P03 domain-admin、P04 role + step-up、P05 event、P06 audit、P07 health、P08 costs、P09 release evidence、P10 config/version；**不預先產生 60 個假 API 或可直接寫任意 D1 的萬能後台**。

## 六、業主日後需要裁決的最少決策（**現在無須逐題回答**）

| 決策 ID | 問題 | 缺核准時的安全預設 |
|---|---|---|
| APP-D01 | 首款 App 解決哪個具體問題？誰會日常使用？A 或 B？ | `UNDECIDED`，只作假資料 UX/用戶價值研究 |
| APP-D02 | App 名稱、Logo、預定市場/語言/年齡、公司顯示與商店發布主體？ | `UNDECIDED`，不建立真商店 listing 或 bundle ID |
| APP-D03 | 是否一期就做正式 IAP／訂閱？SKU、權益、定價、退款怎麼定？ | `UNDECIDED`，免費 Battery 絕不當付費貨幣 |
| APP-D04 | 首次註冊 X、首次成功任務 Y、費率、透支額度與保留/補償政策？ | `UNDECIDED`，測試值僅供 fake fixtures |
| APP-D05 | Q104/Q119 訂立哪些合法目的、同意、刪帳/保留、反重贈與 KMS/不可回退權威？ | `UNDECIDED`，資料保護 fail closed |
| APP-D06 | ADR #87 跨 D1 A（特定交易權威）或 B（持久 Saga）與真 Queue/D1 測試、外部 witness？ | `UNDECIDED`，只許本地模擬 |
| APP-D07 | Cloudflare/Store/EAS/OIDC/裝置測試的實際權限、免費使用限額、硬成本上限與事故退出？ | `UNDECIDED`，不發出任何真測試或付費調用 |
| APP-D08 | 第二款 App 和 Wave2 Starry Admin 是否正式立案？ | `UNDECIDED`，不自動開工 |

## 七、App Store／Play／Expo 官方前置驗收（網址為供未來核對，非本案已合規證據）

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)：應審核功能完成度、帳號必要性、官方數位商品 IAP 情境、可供審核的功能/測試說明。不得把 Billing mock 視為真 IAP。
- [Apple: account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)：支援建立帳號的 App 須能發起刪除帳號；有留存義務者應另依法揭露。
- [Google Play: account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)：適用建立帳號的 App，需可從 App 內及外部指定 Web 資源提出刪除；需在 Data safety 表單如實提供實際政策。
- [Expo: EAS Build](https://docs.expo.dev/build/introduction/)：可用於獨立 iOS/Android binary 和測試分發，**本計畫沒有要求執行 build、submit、update 或使用付費額度**。原生編譯與端到端真機/審核須在業主明確同意後另做。
- Apple / Google / Expo 官方要求可能更新，**真正準備上架時要重新查當時最新版**；此文是 checklist，不是合規律師意見或商店審核通過證據。

## 八、如何驗收本 AI-0 規劃成果
- `docs/operations/future-starry-app-portfolio.v0.json`：機器可讀 Portfolio、候選用途、phase Gate、8 個待決、Owner 工作隔離；**所有真人使用、SKU、價格、真 App ID、部署與 approval 都為空/false**。
- `docs/operations/verify-future-starry-app-portfolio.mjs` + `packages/integration/test/future-starry-app-portfolio.test.mjs`：離線可執行拒絕測試，防止有人把 `starry-id-dev` 轉正式 Store、憑空宣稱第一款 App 選定或啟動 Wave2/付費/Live。
- 不新增 SQL、mobile features、公開 Worker route、CI workflow、真帳號、商店檔案、付費；不修改 R18 專責代碼／官方 Release JSON。
- 四位 AI 的 R18 開發獨立繼續；**只有其新 Commit + 同 SHA CI + AI-0 再次新整合 PR**才能稱 R18 四 Owner 同版離線完成。此路線圖不是該驗收的替代品。
