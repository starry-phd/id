# ADR D-04｜業主正式決議：先比較廣告平台，不指定供應商（2026-10-28）

> **決議狀態：OWNER_APPROVED_OPTION_C_EVALUATION_ONLY / AD_PROVIDER_UNDECIDED / NOT_IMPLEMENTED**  
> 業主原話：「**D-04 我正式選擇方案 C（先比較其他廣告平台）。請記錄到 GitHub，說明正式選型及授權界線，接著繼續 D-05 下一題。**」

## 1. 現行決議的精確涵義

- **D-04 已決定的是比較程序（C），不是已選任何實際廣告 SDK、廣告聯播網、Mediation 供應商或收入分潤模式。**
- 原 [Starry 共用技術基座 v1.0 候選版 §4、§11 D-04](https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ/edit) 中 AdMob＋UMP／ATT 屬**原提案**，在本次方案 C 後**不得被當成已採用正式供應商**。先前 AI-4/DEV-I 在 App Factory 預留 Ads Adapter 插槽，應維持**關閉狀態／provider=none**，除非未來比較與真機測試結束、業主另作正式供應商決議。
- **比較三種「Mediation 控制層」候選，不把底層廣告供給網路與 Mediation 混成同一決策**：① Google AdMob Mediation；② AppLovin MAX；③ Unity LevelPlay。個別網路（如 Google AdMob demand、Unity Ads、AppLovin demand、Meta Audience Network 等）可作「候選廣告需求來源」另外評估是否可由選定 Mediation 接入。
- 不預設首 10 款 App **一定**投放廣告；一款 App 可以保持 `ads_enabled=false`，一款可有合法廣告及訂閱/買斷去廣告。所有收入、eCPM、填充率、網路資格、平台/SDK兼容、費率、廣告品質與產品組合，**沒有真實證據前一律 UNKNOWN**，不得編造收入、讓示範分數變正式排名。

## 2. 來源：截至 2026-10-28 官方文件可證實的能力（≠ 本專案已可用）

| Mediation 比較候選 | 官方文件指出的主要方向 | 仍須真實 PoC 的問題 |
| --- | --- | --- |
| **Google AdMob Mediation** | 可在同一中介層整合 AdMob 與其他第三方競價/瀑布式來源；須設定各網路的隱私/同意資訊。[Google 官方](https://developers.google.com/admob/android/mediation) | React Native／Expo **本專案版本** 的插件、iOS/Android 原生建置、不同網路 Adapter、UMP／ATT、台灣及其他國家填充率/結算成本；不可將原 Google Android SDK 文件當成 RN/Expo 官方支援證明 |
| **AppLovin MAX** | 官方提供 React Native 模組及 Mediation 的多網路接入文件。[React Native 官方](https://developers.axon.ai/zh/max/react-native/overview/integration/)／[MAX Getting Started](https://support.applovin.com/en/max/getting-started) | 本專案 Expo managed/dev build 與插件版本、各網路核准/隱私責任、iOS ATT、原生架構與廣告格式；不可因文件存在就宣稱 Expo SDK 58 相容 |
| **Unity LevelPlay** | 官方有 React Native plugin、網路 Adapter 與測試流程；支援多廣告格式。[React Native 官方](https://docs.unity.com/en-us/grow/levelplay/sdk/react/plugin-integration)／[支援的網路](https://docs.unity.com/en-us/grow/levelplay/sdk/react/mediated-networks-index) | Expo native build、每個網路的 Android/iOS 原生依賴與 App 隱私合規、填充/收益及差異化成本，未有本專案原生實測 |

**本表是供應商官方文件與 AI-0 編排的比較範圍**，不是供應商簽約條件、真實收益預測或廣告相容性實證。正式 SDK/價格/政策應在開始測試前重新查閱最新官方資料。

## 3. 比較準則、決策證據（本輪均尚未評分）

1. **React Native + Expo + Expo Router／D-01 原生版本相容**：iOS/Android Development Build 可驗證、插件維護週期、新架構與 EAS 預覽／回退；SDK 58/RN 0.88 仍須 D-01 實際採用/驗證，不能直接說可上。
2. **首批 10 款 App 維護成本**：一個共用 AdsClient Adapter 並且 per-App `app_id`／`ad_unit_id`／商店分離；每 App 能決定 `ads_enabled`、廣告格式與是否有合法廣告。
3. **廣告收益與風險**：只用實際測試 App 的可核對比較資料（曝光、eCPM、填充率、區域/受眾、測試平台與期間），不捏造未投放前的金額；品牌安全、廣告素材品質、崩潰率、追蹤/額外電量/網路成本須核對。
4. **合規與使用者選擇**：實際所需的 GDPR/EEA、其他地方法規、各來源同意傳遞、iOS ATT 權限、Google UMP 或等效 CMP 流程，未達必要合規／未核准時**禁止啟動廣告載入**；不同供應商不可假定 UMP 一套自動覆蓋全部網路。
5. **D-03 RevenueCat 權益整合**：僅在**此 App 的受信、有效**買斷去廣告或訂閱含去廣告權益下停止廣告；退款/撤銷/過期對付費狀態依中央 AI-2／DEV-B 唯一正式投影處理。跨 App 不共享去廣告，D-07 未決。
6. **費用、可移轉與隱私**：實際 SDK / Mediation 合約、帳號准入、支付門檻、最低付款與稅務、D-06 費用額度、App 各自轉移/撤換難度及資料刪除/退出權利。部分平台要求廣告帳號/原生整合，不能預設零費用／零限制。

比較表應每個候選至少附具日期的官方來源、native smoke 結果及 Android/iOS 測試裝置/環境、合規表、每 App 設定/SDK 功能列表、成本/權利負擔與失敗/回退證據。缺一則只標 `NEEDS_EVIDENCE`；是否選 Mediation A/B/C 或完全不啟用廣告，**由業主再決定**。這一回合只授權官方文件唯讀研究和獨立 GitHub Draft ADR/CI，沒有授權真 SDK/測試投放或帳號註冊。

## 4. 實作/權威邊界

- **AI-0**：維護 D-04 C 評估／來源／未決清單及使用者正式最後供應商決議；不因過去 AI-0 候選 AdMob A 提案而將 AdMob 啟用。
- **AI-4（DEV-I/G）**：依正式批准後的 D-01／SDK，負責新私有 Monorepo 中 App Factory 的 Ads Adapter 和原生 PoC；**目前只有 evaluation，無實際安裝**。
- **AI-2（DEV-B）**：D-03 已選 **RevenueCat＋薄 BillingClient**，仍唯一正式付費權益授權方；「去廣告」不可由任一 Ad SDK 或 App 客戶端旗標自我核准；免費 Starry Battery 不可作付費獎勵或廣告商品化。
- **D-02** 已選 **A：首階段單一全新私有 App Monorepo**；既有 Public `starry-phd/id` Auth/Billing/Battery 唯一 Writer 保留獨立，App 不直連中央 D1，且各 App 自己的廣告單位/商品/Bundle/發版互相隔離。
- **D-05 RN Web/管理中心、D-06 費用、D-07 跨 App 付費、D-08 UI 尚未決議。** 中央 G00～G10 **11/11 BLOCKED**、P05/PUBLISHABLE=false。

## 5. 確認核准 vs 禁止行為

| 行為 | 決議 |
|---|---|
| D-04 選項 **C：研究比較** | **OWNER_APPROVED_EVALUATION** |
| 官方來源唯讀分析、候選比較/評估準則、GitHub source-only Draft PR、離線安全測試 | **ALLOWED** |
| AdMob／MAX／LevelPlay 或其中一家被**選為正式廣告供應商** | **NO** |
| 建立廣告帳號、App 註冊、接受條款/合同、安裝真廣告 SDK、啟用廣告、測試廣告網路、認證／蒐集追蹤 ID | **NOT AUTHORIZED** |
| 真 iOS/Android Native Build、EAS、Cloudflare Workers/D1、App 收費／廣告變現、改 main、使用 H-Global | **NOT AUTHORIZED** |
| 要求每款首批 App 都投放廣告 | **NO** |
| 後續選平台、實際 SDK 插件、各 App Ad Unit、Consent/ATT/UMP 等合規、成本及真試播/退出 | **LATER EXPLICIT APPROVAL + REAL POC** |

本文件以業主的 **C 比較決議**為權威，不修改先前已核准 D-02 A／D-03 A、中央 Billing/Member/Battery 或各 Owner 既有程式。
