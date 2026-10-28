# AI-0 D-01｜Expo SDK 58／React Native 0.88 原生相容性研究與隔離 PoC 計畫（2026-10-28，**候選／待業主核准**）

> **狀態：READ_ONLY_RESEARCH_AND_POC_PLAN / OWNER_D01_NOT_YET_APPROVED / NO_NATIVE_POC_RUN / NOT_IMPLEMENTED。**
>
> 前情：使用者於本輪說「請繼續」，延續已核准 D-02～D-08 的總表；本件**只被授權研究和編排 GitHub source-only Draft Plan**，**不將 D-01 Expo SDK 58 的版本選型冒稱業主已批准**，不得藉「繼續」建立私有 Repo、新 App、付費 EAS/Cloudflare/Store 及真實 Native Build。

## 1. 已有證據 vs 尚未實測

- [Expo SDK 58 官方 2026-10-15 Changelog](https://expo.dev/changelog/sdk-58) 與 [Expo SDK 版本表](https://docs.expo.dev/versions/v58.0.0/) 確認：**Expo SDK 58＝React Native 0.88／React 19.3／React Native Web 0.21**，Node.js 最低 22.13.x（22 線）或 24.3.x（24 線）。SDK 58 的 React Native 0.88 嚴格 TypeScript API、部分舊 RN API 移除、Expo Router 內部導覽改動、SDK 58 Web `web.output` 預設 server 等需實際驗證。**SDK 58 已正式發布≠本專案所有原生插件都相容**。
- 既有 Public 中央 `starry-phd/id` 在 R32（D08）固定 HEAD `86c7f055c4238911ad3dc8c3223627774666a388` 的 `apps/mobile/package.json` 實際鎖定 **Expo `~54.0.20`／RN `0.81.5`／React `19.1.0`／Expo Router `~6.0.13`**，root `npm workspaces`／Node `>=22`。本研究**不修改任何中央套件/鎖檔**，更不允許升級這份中央會員/Battery/Billing Repo。
- [RevenueCat 官方 Expo 安裝指南](https://www.revenuecat.com/docs/getting-started/installation/expo)：支援 Expo Development Build 下 `react-native-purchases`／`react-native-purchases-ui`；Expo Go 的 Preview API Mode 可模擬介面/流程，**不能完成真 Store 交易**，原生 SDK 必須重建 Development Build。這不是 Expo58+RN0.88 真二端測試成功證據。
- [Expo 官方 Sentry 指南](https://docs.expo.dev/guides/using-sentry/)：提供 `@sentry/react-native`／wizard、EAS build/update 整合，需有效帳號、來源圖/Release 信任等步驟；**本案未啟用外部 Sentry 專案/帳號或遙測**，且尚未驗與 RN0.88 一起編譯。
- [React Native Google Mobile Ads Expo 插件指南](https://docs.page/invertase/react-native-google-mobile-ads)：說明 Native Config Plugin 與 Expo Go 無法使用真原生廣告 SDK、須 Development Build；若未有正確廣告 App ID 設置可能 Build／啟動失敗。**D-04 已正式選 C「先比較廣告平台」，AdMob／MAX／LevelPlay 尚未選定**，故本研究只把此類原生整合風險列為 *generic Ads Adapter* PoC 待定，不得直接安裝 AdMob SDK 或申請真 AdMob ID。
- [Expo 官方開發 Build FAQ](https://docs.expo.dev/develop/development-builds/faq/) 和 [本機 EAS Build](https://docs.expo.dev/build-reference/local-builds/)：Expo Go≠能測完整真原生套件；Development Build 可在核准工程上操作；本機 Build 需自備工具與本機 Mac/Xcode／Android SDK/NDK，EAS `--local` 仍需 Expo 登入與專案，不等於完全離線免費/無授權。本輪沒有執行。
- [Expo SDK 58 升級指南](https://expo.dev/blog/how-to-upgrade-to-sdk-58)：文檔著重 Strict TypeScript API、移除舊 RN API 與遷移影響。**不應對現有 Expo54 中央工程直接套用「從 SDK57 到58」的升級腳本**。

## 2. D-01 決策候選（尚未正式選定）

| 方案 | 定義 | 好處/風險 | 本輪業主授權 |
|---|---|---|---|
| **A（建議）** | **先在另行明確核准的隔離合成 App 工程驗證 Expo58/RN0.88，再依結果正式選版** | 最新長期基座可能較有利，但需 native plugin build／測試與費用/權限 gate；**通過前不能認定已採用** | **僅提出，不是已批准** |
| **B** | 首批先用已可驗證的較舊／替代 Expo SDK 組合，Expo58 保留研究 | 避免未確認的相容性阻塞，但要核對實際可用 SDK、Store 要求與未來升級成本 | **僅候選** |
| **C** | 暫停正式 Expo SDK 版本選型，先只做不依賴真 native 的離線介面／契約研究 | 最少外部操作，但推遲 App 的 iOS/Android Native Gate | **僅候選** |

**不採「現在一鍵將既有中央 Repo 升到 SDK58」作為 D-01 候選**；新 App 私有 Repo 未批准建立，而現有 `starry-phd/id` 不可拿來做破壞性的 Native/付費試驗。

## 3. 逐階段真 Native PoC（全項皆 PENDING，必須先批准具體操作）

**Phase 0｜唯讀盤點（本輪可完成研究，不是 Native 實測）**
- 查 Expo58/RN0.88/React19.3/Node 的當期官方版本與-breaking changes；比對 `apps/mobile/package.json` 的 Expo54/RN0.81.5。
- 列出 RevenueCat／Sentry／D04 *未選 Ads 供應商* 的安裝/插件依賴、敏感資料/第三方條款與可能費用。只記 `DOCUMENTED_GUIDANCE`、`NOT_VERIFIED_EXPO58_NATIVE`。
- 不建立任何 SDK/外部帳號、原生 build 或付款；所需金鑰/營收個資不儲存在 GitHub 文件。

**Phase 1｜事前授權 Gate（**必須經業主另行明確同意**）**
- 明列新私有 Repo 名稱/owner/ACL/建置環境（D-02 結構已核准但建立尚未核准）、建立多少*合成 App*、`bundleId/applicationId`、來源依賴 hash/lockfile；
- 明列是純本機 Build、Expo EAS Free 額度還是會有超額計費；**D-06 已選 A，任何新增付費/超額/升級逐筆批准**，Expo 本機 `--local` 也可能需外部帳號與設定，不能直接假定 0 成本或可用；
- 明列責任分工（AI-0 Gate；AI-4 DEV-I 真原生 App；AI-2 DEV-B RevenueCat 真商店測試；AI-1/3 mock Clients，**不碰中央 Writer**）、個資/隱私/密鑰、cleanup、成本上限；
- 若任何關鍵條件未知/未批准，保持 **BLOCKED**，不進下一 Phase。

**Phase 2｜合成 Native Build（尚未執行）**
1. 新增**隔離 synthetic App 殼**，先只加入 Expo Router、TypeScript、StyleSheet+Tokens(D08)、純合成會員/Battery/BillingClient mock，不接任何真 Auth、Billing、Battery，測 iOS Simulator／Android Emulator cold start、導航、畫面/主題、無障礙、Deep Link、崩潰/復原。
2. 分別插入 RevenueCat SDK **編譯測試**，有官方允許的 Preview/Mock 路線先用 mock；真 Store Sandbox 的購買/退款/訂閱屬 **另一個必須額外核准的 Phase 3**，本階段不得開真商店或給 VIP/去廣告。
3. Sentry 以明確同意前的 local/mock 或可停用方案驗證編譯，禁止預設對外傳送真會員資料、錄影或遙測事件。
4. Ads 因 D-04 provider 未選，先用 `NoopAdsAdapter`；**不可偷偷安裝 AdMob/MAX/LevelPlay、呼叫 Ads 網路或開 UMP/ATT 追蹤**。未來 D-04 真選定並獨立授權後再補真 Ads Native Build。
5. 模擬 App A→B `Bundle/SKU/AppID` 混用、跨 env/會員/付費/去廣告/免費 Battery 操作須 fail-closed；同 App iOS↔Android 權益仍待 D-07 獨立決議與官方 Store 測試。

**Phase 3｜真 Store/RevenueCat／合規測試（完全不受本輪授權）**
- RevenueCat 帳號/專案/商店憑證、測試商店商品/訂閱、真 Sandbox 合成購買恢復、撤銷/退款/到期/去廣告與中央唯一 Writer、安全 P05/#87/Q104/Q119；AI-2/Store/隱私權限核准先行；
- D-04 最終廣告商要另外由業主正式選定＋採用 native SDK/UMP/ATT 對應測試/追蹤資料合規，不能因 SDK58 能跑就假設 Ads 已核准。

## 4. Gate 的通過證據（禁止造假）

| 項目 | 交付證據/驗收 | 初始狀態 |
|---|---|---|
| Expo58/RN0.88 SDK 與 Node/React 依賴 | 官方來源＋實際 lockfile/commit SHA | **DOCS CONFIRMED／實際未驗** |
| iOS + Android Dev Build | 每平台真 Build ID、Simulator/Device/OS、CI SHA、冷啟動/Crash Logs | **NOT STARTED** |
| StyleSheet + Tokens/UI 套件 | 不同 App Theme/深色模式/字體/無障礙，不能干擾中央服務 | **NOT STARTED** |
| RevenueCat Expo Native adapter | 雙平台真插件整合 Build；Store Sandbox 購買另批 | **NOT STARTED** |
| Sentry Native adapter | 原生整合與來源圖/事件隱私，無未授權真遙測 | **NOT STARTED** |
| Ads Native adapter | 只可 Noop 設計；真 SDK 要待 D-04 正式供應商 | **PROVIDER UNDECIDED** |
| AppA/B/Environment/Token 防串權 | 真 Sandbox 負向驗證＋backend AI-2 唯一 Writer | **NOT STARTED** |
| EAS/Repo/Cloudflare/成本 | 業主明確授權、各平台帳單及 hard cap/alert 差異 | **NOT APPROVED** |
| 中央 G00–G10、P05/PUBLISHABLE | 正式 release-readiness 真值，不可由本測試覆寫 | **11/11 BLOCKED** |

## 5. 與 D-02～D-08 已選政策保持一致

- D-02＝A 全新私有 Starry 多 App Monorepo **架構已核准、Repo 未建立**，原 Public 中央 Auth/Billing/免費 Battery 不移植、不改 Writer；
- D-03＝A RevenueCat＋薄 BillingClient 已核准**供應商選型**，不意味真商店 SDK／帳戶已接入；
- D-04＝C 先比廣告**最終供應商仍未定**，不能宣稱 AdMob 已選；
- D-05＝A App Web 選配（初始 OFF），中央第二波 Admin 保留獨立 React/Vite/TanStack Web；
- D-06＝A 免費先行，新增付費/超額**每筆先經業主批准**，月預算金額未決；
- D-07＝A 各 App 付費/去廣告不互通，同 App 跨平台權益仍待真 Store 規則決議；
- D-08＝A 消費者 App StyleSheet＋Design Tokens＋自有共用 UI library；在新私有 App Repo 的套件尚未開發；H-Global 獨立且暫停。

**本文件與相關 JSON/Node 測試僅是 AI-0 可追溯的候選規劃，不是業主 D-01 正式選項決定或原生 PoC 完成。**
