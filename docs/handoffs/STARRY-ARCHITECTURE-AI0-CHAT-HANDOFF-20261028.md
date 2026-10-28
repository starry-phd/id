# Starry 新架構開發｜AI 跨對話 GitHub 接續交接｜2026-10-28

> **交接方式**：GitHub `starry-phd/id` 是本工作流的可追溯進度與決議來源；ChatGPT 對話不應被視為已部署程式或獲授權改動。本文件是**來源唯一的轉場索引**，不取代各 ADR/PR/CI 或中央 Release Gate。
>
> **使用者最新指示**：「現在更換ai對話串，用github交接繼續」。因此只做**既有 GitHub 的文件/Issue 交接**，不以切換對話授權執行真正 App 建置、付費、部署或合併。

## 一、新 AI 首先讀取的固定入口

- **現有中央 GitHub Repo**：https://github.com/starry-phd/id （**Public**；現有中央會員 Auth、Billing、永久免費 Battery 的程式與唯一 Writer 由各專責負責。**不是**要建立的消費者 App 私有 Monorepo）。
- **AI-0 總管主線**：https://github.com/starry-phd/id/issues/1
- **共用技術基座與 D-01～D-08 需求總控**：https://github.com/starry-phd/id/issues/156
- **10→30–50 App 組合追蹤**：https://github.com/starry-phd/id/issues/158
- **AI-1～AI-4 專責**：https://github.com/starry-phd/id/issues/2 、https://github.com/starry-phd/id/issues/3 、https://github.com/starry-phd/id/issues/4 、https://github.com/starry-phd/id/issues/5
- **第二波 Starry 管理中心已核准技術、未實作**：https://github.com/starry-phd/id/issues/15
- **D-01 目前研究/原生 PoC 計畫 Draft**：https://github.com/starry-phd/id/pull/186（branch `ai0/r33-20261028-d01-readonly-native-poc-plan`；基於 D-08 Draft #185，非 `main`）
- **D-01 研究 ADR**：`docs/adr/AI0-D01-EXPO58-NATIVE-COMPATIBILITY-RESEARCH-POC-PLAN-20261028-DRAFT.md`。
- **D-01 技術與權限機讀規格**：`docs/operations/ai0-d01-expo58-readonly-compatibility-research.v1.json`，明確 `owner_approved_D01=false`、`selected_option=null`、`ios_android_builds_completed=0`。
- **D-08 與全部決議的權威狀態總表**：https://github.com/starry-phd/id/pull/185 、`docs/adr/AI0-D08-OWNER-APPROVED-STYLESHEET-DESIGN-TOKENS-UI-LIBRARY-20261028.md` 和 `docs/operations/ai0-d08-owner-approved-style-tokens-shared-ui.v1.json`。
- **候選基座 Google Docs**：https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ （2026-10-28 **候選版**，若與後來經業主核准的 GitHub D-02～D-08 ADR 衝突，按新正式決議記錄與時間處理）。
- **GitHub 提交狀態必須逐次重查**：PR `head_sha`、是否 Draft／merged、同 SHA Actions、Issues 及 Release 真值；不能把新對話開啟的時間視為合併/部署。

## 二、D-01～D-08 正式選擇、不可誤讀的界線

| 決議 | 業主最後正式選擇 | 實際可用/待決範圍 | GitHub |
|---|---|---|---|
| **D-01** | **未選定** | **建議 A = 獨立合成 Expo SDK58/RN0.88 原生 PoC 後再決版本**；但「建議」≠核准，沒有 iOS/Android Development Build；現有中央 Expo54/RN0.81.5 不升級 | [#186](https://github.com/starry-phd/id/pull/186) |
| **D-02** | **A** | 一個**新私有 Starry 多 App Monorepo** 的**架構方向已核准**，不是 Repo 已建成。Public `id` 中央 Auth/Billing/Battery 不遷移 | [#179](https://github.com/starry-phd/id/pull/179) |
| **D-03** | **A** | RevenueCat＋Starry 自有薄 BillingClient，AI-2 唯一付費權益 Writer；Store/RevenueCat 真接入未開始 | [#180](https://github.com/starry-phd/id/pull/180) |
| **D-04** | **C** | **先比較** AdMob Mediation、AppLovin MAX、Unity LevelPlay；實際廣告平台**尚未選定**，廣告 OFF；不能偷用 AdMob | [#181](https://github.com/starry-phd/id/pull/181) |
| **D-05** | **A** | 各消費者 App Web 版選配、初始 OFF；獨立的 Starry 第二波 Admin Web React/Vite/TanStack 等已核准技術保持不變，第二波 UI **尚未啟動** | [#182](https://github.com/starry-phd/id/pull/182) |
| **D-06** | **A** | **免費優先、每筆新付費/超額升級都要業主具體批准**，沒有授權任何金額；每月預算金額**尚未決定**；既有被動計費須如實看帳單 | [#183](https://github.com/starry-phd/id/pull/183) |
| **D-07** | **A** | **各 App 付費/VIP/買斷/去廣告權益獨立**，不可 A 購買解鎖 B；同一 App 跨 iOS↔Android/選配 Web 權益**另案待商店與沙盒驗證**；中央免費 Battery/會員可按契約共用 | [#184](https://github.com/starry-phd/id/pull/184) |
| **D-08** | **A** | 消費者 App **StyleSheet＋Design Tokens＋自有共用 UI 元件庫**；每 App 品牌視覺/畫面仍獨立；元件包**未建立**，不等於 Admin 改成 RN | [#185](https://github.com/starry-phd/id/pull/185) |

**總計 7/8 正式業主架構或政策決定（D02～D08）；D01 仍待正式選定。** 另外 D04 廣告最終商、D06 具體月度預算、D07 同 App 跨平台權益仍各自獨立未決。

## 三、GitHub PR/CI 與程式狀態（交接時點）

1. 各項決策 ADR 都寫進目前 **Public `starry-phd/id` 的 Draft PR 連鎖分支**：D02 #179 → D03 #180 → D04 #181 → D05 #182 → D06 #183 → D07 #184 → D08 #185 → D01 研究 #186。**不要誤認這些 Draft 已合併 main，或已建立新的私有 Monorepo。**
2. D02～D08 的每一份已有 GitHub issue comment 和 PR/CI 證據；最新**精確** CI 需由新 AI 重新核對 GitHub Actions，不能引用前版成功給新 SHA。
3. [#186](https://github.com/starry-phd/id/pull/186) 本輪僅新增**官方相容研究＋合成 PoC 計畫＋離線測試**，不升級既有 `apps/mobile/package.json`；existing central currently `expo:~54.0.20, react-native:0.81.5, expo-router:~6.0.13`。
4. 無真 RevenueCat SDK/收費、無 Ad SDK、無指定私有 Repo、新 App、App Store 版本、真 EAS Build、Staging 或 Production 可因文件宣稱完成。
5. 正式中央 `G00–G10` **11/11 BLOCKED、P05/PUBLISHABLE=false**；本交接不合併 main／不部署／不改中央 Auth/Billing/Battery Writer、Secrets/Cloudflare／不觸碰 H-Global（暫停）。

## 四、新對話「真正下一步」及精準權限

**第一步（直接可做，零外部資源）**：從 GitHub 讀 Issue #1/#156 最新 comment + PR #186、D01 ADR/JSON、PR #185 D01–D08 決策總表；核對当前 SHA、CI、是否 merged、中央 release。向業主簡短回報：
- **D-01 官方資料已確認的部分**：Expo SDK58/RN0.88 公布；RevenueCat Expo、Sentry、原生廣告 SDK 都有整合文件，**但沒有證據顯示這些已在本項目 SDK58 + iOS/Android 真實 Dev Build 一起通過**。
- **提出 D-01 選項**：A = 先在**另行核准**的新隔離合成 App 工程實測 SDK58/RN0.88 再正式採用（建議）；B = 另研究已實測較舊/替代版；C = 暫停選型，繼續唯讀研究。
- 如業主按 A，**只能把「先驗證方向」當作決策核准，不能把它當成實際建立 private Repo、使用 EAS、Store、RevenueCat 或付費授權**。另列出欲建立 Repo 的具體帳號/名稱、ACL、測試 App 數量、iOS/Android Build 執行方式、費用及硬限、資料/密鑰隔離與回退，逐項申請當次許可。
- **D-04 最終廣告商未定**，Phase 1/2 先採 `NoopAdsAdapter`；不可因 Expo58 研究而直接選用 AdMob。
- 僅在批准真合成 Native PoC 的人員、Repo、環境、預算/帳號且技術條件具備後，AI-4 DEV-I 開始 iOS/Android 獨立 development build；RevenueCat 真 Store Sandbox、退款/恢復、及 Ads 真 SDK 要另外走 AI-2、D-04 與業主授權。
- **不可承諾「背景持續執行」或自動喚醒四個聊天**；GitHub Issue/PR 是交接與人/代理下一次讀取的持久狀態，非即時排程。

## 五、下一個新 ChatGPT 對話直接貼這段

> 請接手 Starry 新架構開發，**以 GitHub `starry-phd/id` 為唯一最新開發真值**。先讀 [AI-0 Issue #1](https://github.com/starry-phd/id/issues/1)、[共用基座 Issue #156](https://github.com/starry-phd/id/issues/156) 和 [D-01 Draft PR #186](https://github.com/starry-phd/id/pull/186) 裡這份 `docs/handoffs/STARRY-ARCHITECTURE-AI0-CHAT-HANDOFF-20261028.md`，並核對最新 PR HEAD 和 **同 SHA** GitHub Actions、正式 11/11 Release Gate。延續 D-01 Expo SDK58/RN0.88 **研究與原生 PoC 方案的確認**，不要把 D-01 尚未核准的候選當已決。D02～D08 的七項業主正式選擇以 GitHub ADR/JSON 為準；D04 最終廣告平台、D06 預算金額、D07 同 App 跨平台權益未決。**任何新 private Repo、真 Native Build、RevenueCat/Store、Cloudflare、EAS、付費、部署及 main merge 必須另獲業主明確授權**。請極精簡報告我下一步需確認什麼，勿重問已核准決議。
