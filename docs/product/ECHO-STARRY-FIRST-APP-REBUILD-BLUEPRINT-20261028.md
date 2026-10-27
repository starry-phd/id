# AI-0｜首款新架構 App「繁星回聲」：舊版功能盤點 × 混合技術重建方案 v0.1

> **2026-10-28 台灣｜確定的決議只有「第一款 App = 繁星回聲」；本文件的 P0/P1/P2 是 AI-0 開發建議，並非業主已核定的 MVP、已改寫舊程式或真實上線進度。**

## 來源與範圍
- 舊站 [yukidu/Echo-Starry](https://github.com/yukidu/Echo-Starry/tree/82cbf4f112af57fcfed12ff2f6cf86010c03560e) `82cbf4f112af57fcfed12ff2f6cf86010c03560e`：Github tree 查看 607 個檔案、`src/components` 50、`worker` 88、`tests` 230。實際查核了 React/Vite、Cloudflare Worker/R2/D1/KV、音檔播放器、瀏覽器離線 CacheStorage、搜尋/分類、講者、貼紙/VIP、逐字稿/AI QA、管理後台及代表程式碼。**並非已審查全部 607 個檔案邏輯**。
- 新版 [AI-0 R21 四專責離線整合 Draft #148](https://github.com/starry-phd/id/pull/148) `fbd5c03156da700b68c7b5bceb65269cb7c900ec`：有新 Starry ID/Auth、Billing、Task/Battery、API/Saga 的**離線候選安全契約**；不是正式 Echo App 或真跨 D1 生產系統。
- 業主已指定**第一款新架構 App 是「繁星回聲」**（不是舊紙面 #136 Consumer-A 通用任務產品）。AI-0 原 #130 / #140 JSON 對首款「尚未選定」是**早期舊紀錄，必須以新業主決議為準**；本輪不偷偷修改它們的 Gate/測試，另建產品選擇的受控新文件。
- 本文件的 `P0` 是首批驗證與 MVP 候選，不代表全部 P0 必須一起首發，亦不包含授權執行任何真 Cloudflare / Store / 付費。

## 建議結論
**另開真正的繁星回聲新專案，採 RN + Expo Router + TypeScript 兼顧 iOS/Android/Web；舊 GitHub 僅作需求樣本/資產及純 TS 測試參考。** 不改原 Web 主專案，不直接用 WebView 套殼、也不盲目重寫每個純函式。實作時：`Echo App native UI → 新 Echo typed API → Echo-isolated Cloudflare Workers → Echo-specific D1/R2`；登入經唯一正式 Starry ID contract；免費 Battery/Task 只能經未來合規的專責服務，禁止舊 Worker 直寫跨系帳本。

**官方 Expo 能力現況**：Expo Router 支援 Android/iOS/Web 共用路由但有平台差異；`expo-audio` 有背景播放及鎖定畫面設定，Android 長時間背景播放需 foreground service/lock screen controls；真正離線檔案及保存/清理不能靠舊瀏覽器 CacheStorage，需 Expo FileSystem / 原生儲存策略並在 iOS/Android 實測。官方來源：
- <https://docs.expo.dev/router/introduction/>
- <https://docs.expo.dev/versions/latest/sdk/audio/>
- <https://docs.expo.dev/versions/latest/sdk/filesystem/>

## 40 個舊功能／技術模組的可追溯建議清單

每項 Legacy Git source path 皆來自上述 `82cbf4f112af57fcfed12ff2f6cf86010c03560e` 的 GitHub git tree；對照 Git Blob SHA 固定在 `docs/product/echo-starry-first-app-legacy-feature-map.v0.json`。**舊檔存在 ≠ 其產品功能可靠、安全或適合直接移植，亦不代表新版已有該功能。**

| ID | 舊功能或技術 | 提議波次 | 重建原則 | 負責領域 |
|---|---|---|---|---|
| EH-01 | 首頁音檔清單 | P0 | rewrite_native_ui | AI-4 |
| EH-02 | 關鍵字搜尋 | P0 | extract_pure_ts_review | AI-4 |
| EH-03 | 分類與音檔排序 | P0 | rewrite_native_ui | AI-4 |
| EH-04 | 單集詳情 | P0 | rewrite_native_ui | AI-4 |
| EH-05 | 播放／暫停／快轉／倍速 | P0 | rewrite_native_ui | AI-4 |
| EH-06 | 背景播放／鎖屏控制 | P0 | rewrite_native_ui | AI-4 |
| EH-07 | 離線音檔與檔案回收 | P0 | rewrite_native_ui | AI-4 |
| EH-08 | 播放進度續聽 | P0 | extract_pure_ts_review | AI-3 |
| EH-09 | 訪客／登入入口 | P0 | new_domain_contract | AI-1 |
| EH-10 | 付費內容與可見性 | P0 | new_domain_contract | AI-2 |
| EH-11 | 我的收藏 | P0 | rewrite_native_ui | AI-4 |
| EH-12 | 講者基本頁面 | P0 | rewrite_native_ui | AI-4 |
| EH-13 | 音檔 API 與資源隔離 | P0 | new_domain_contract | AI-4 |
| EH-14 | 媒體 R2 與授權下載 | P0 | new_domain_contract | AI-4 |
| EH-15 | 公開分享／Deep Link | P1 | rewrite_native_ui | AI-4 |
| EH-16 | 留言與回覆 | P1 | rewrite_native_ui | AI-4 |
| EH-17 | 通知中心 | P1 | new_domain_contract | AI-4 |
| EH-18 | 逐字稿閱讀 | P1 | rewrite_native_ui | AI-4 |
| EH-19 | 逐字稿產生工作流 | P1 | new_domain_contract | AI-3 |
| EH-20 | 我的收聽歷史 | P1 | extract_pure_ts_review | AI-3 |
| EH-21 | 會員檔案與設定 | P1 | new_domain_contract | AI-1 |
| EH-22 | 暗色／字級／輔助使用 | P1 | rewrite_native_ui | AI-4 |
| EH-23 | 分享圖卡與匯出 | P1 | rewrite_native_ui | AI-4 |
| EH-24 | 貼紙與互動獎勵 | P2 | defer_until_policy | AI-2 |
| EH-25 | VIP 專屬音檔管理 | P2 | defer_until_policy | AI-2 |
| EH-26 | AI 針對講者問答 | P2 | defer_until_policy | AI-4 |
| EH-27 | AI 講者人物傳記 | P2 | defer_until_policy | AI-4 |
| EH-28 | 音檔上傳／內容編輯 | P2 | keep_separate_web_admin | AI-4 |
| EH-29 | 逐字稿審核與修正 | P2 | keep_separate_web_admin | AI-4 |
| EH-30 | AI 配額與設定後台 | P2 | keep_separate_web_admin | AI-4 |
| EH-31 | 會員／審核管理 | P2 | keep_separate_web_admin | AI-1 |
| EH-32 | 管理統計 | P2 | keep_separate_web_admin | AI-4 |
| EH-33 | 長音檔分段轉錄 Container | P2 | defer_until_policy | AI-4 |
| EH-34 | Web PWA 安裝與 Service Worker | P2 | keep_web_only | AI-4 |
| EH-35 | 既有共用 speaker parsing | P1 | extract_pure_ts_review | AI-4 |
| EH-36 | 共用 QA 回答安全規則 | P2 | extract_pure_ts_review | AI-4 |
| EH-37 | 舊版登入權限防護 | P0 | new_domain_contract | AI-1 |
| EH-38 | 音檔轉發與串流 API | P0 | new_domain_contract | AI-4 |
| EH-39 | 舊 Web 整合測試作需求樣本 | P0 | extract_pure_ts_review | AI-4 |
| EH-40 | 正式 Cloudflare 組態切割 | P0 | new_domain_contract | AI-4 |

### P0｜先做可單純使用的「找音檔 → 聽音檔 → 續聽」閉環
建議先驗證 Home/搜尋/音檔詳情、播放/暫停/倍速/seek、背景播放、可靠離線、續聽、講者索引、Guest/登入新 Auth、權限可見性、收藏、Echo API/媒體 URL 授權與資料隔離。**P0 包含安全平台基礎，但實際首發取捨仍待業主確認**。
- 分層：`apps/echo-mobile` （候選新 repository，非已建立路徑）供 RN Native; iOS/Android 音訊採能力適配器，不以同一組 Web CSS 模擬；Web 聽眾版可共用純 TS query/view-model；複雜 Admin 改獨立 Web/PWA 且另分權限。
- 「離線可播」需先驗證下載原始音檔、內容可授權、檔案容量/加密/撤權/清理政策和離線失效。舊 `src/utils/offlineAudio.ts` 依瀏覽器 Cache Storage + localStorage，不能等同 RN 檔案系統。
- 舊 `src/mediaSessionPolicy.ts` 與 `MiniPlayer.tsx` 是瀏覽器 DOM/Media Session 導向，切換 RN 時重新建播放器 state machine、背景音訊/耳機插拔/鎖屏，另寫 iOS/Android 真機測試。

### P1｜完成核心體驗後再增加
分享 Deep Link、留言/通知、逐字稿**閱讀**、可合法授權的逐字稿背景任務、收聽歷史、會員設定、深色與無障礙、圖卡分享及嚴審後的純函式。特別注意逐字稿自動轉錄有模型/長音檔 Container/隊列成本，真呼叫需另獲預算與內容同意，P1 並非已批准 AI 上線。

### P2｜不要直接塞進第一個手機版本
貼紙經濟、VIP/Store 商業化、AI 講者 Q&A/自動傳記、上傳/編輯/多角色後台、統計、長音檔分段 Container、舊 PWA Service Worker、QA 回答模型規則等。管理後台**獨立 Web、資源/角色按 Echo 範圍隔離**，不沿用 Starry ID Super Admin 自動授權；Battery 永久免費不可銷售/兌換，VIP/貼紙不是官方已核定 SKU。

## 真正實作的建議先後與「可驗收」條件
1. **產品簽核**：業主從 P0 的 40 項映射選真正 MVP，標注公開/訪客/會員各自可見內容和音檔授權；未獲批准不能把 `selected_for_official_mvp` 變 true。
2. **App 邊界**：決定 Echo 新 GitHub repo、Bundle ID/package、網域與 Echo D1/R2 分隔，Starry ID 服務契約及法遵；不套舊 `wrangler.toml` 的真 resource IDs。
3. **離線薄切片**：完全 fake audio metadata、fake playback adapter、fake search + Auth blocked DTO，Android/iOS/Web 能編譯不代表有真媒體/上架資格。沿用四 Owner R21 正式已存在的唯讀 SDK，不將任何 mock 當真會員。
4. **原生播放器真機階段**：只有另經授權後做背景/鎖屏/藍牙/中斷/續聽/離線儲存的 iOS/Android 真機驗收與合法取得音檔，不使用真正隱私資料作 demo。
5. **安全後端階段**：獨立授權 API/D1/R2、內容權利和來源簽章/Session/Task-D1 架構/Queue/合法保留/檢驗及成本才可申請打開任何 live Gate。
6. **正式上架**：各項 G00–G10 分別人工證據驗收、真 Apple/Google 身份和登入/條款/商店政策/EAS、監控/撤回/災難復原/成本上限，全部完成才可談 Store/Production。

## 新舊代碼選擇規則
- **直接原碼移植**：目前 0 項已認證。像 `src/utils/keywords.ts`、`shared/speakers.ts` 等可檢查純 TS、不碰 Web API/DB/PII 的函式，在新 repo 加明確測試/型別後才選擇性重用。
- **必須重新寫**：DOM/CSS 路由、HTMLMediaElement/Media Session、CacheStorage/localStorage、Web Cookie/Google redirect、Worker 實體 DB/Secret 綁定、所有敏感讀寫交易及跨域 Battery。
- **舊測試 reuse 的意義**：當作行為題目/回歸驗收設計素材，不可宣稱舊 230 份 test 等於 RN 測試通過；新平台需全新 Node + 真機/E2E + API 整合 Gate。

## 正式決策/上線狀態
**第一款 App 名稱已由業主正式指定為「繁星回聲」。** 但是 **MVP/市場/Store Id/Budget/Legacy 資料遷移策略/AI 成本/資源權威均尚待批准**。R22 四 Owner 已各自收到 Issue #2–#5 開發任務；本輪 AI-0 只新增產品自主管理文件/機器驗證，不改 Owner 路徑、GitHub main 或任何生產資料。

嚴格保留：#87 跨 D1 物理 A/B 未定、Q104/Q119 目的/retention/HMAC/KMS、P05 簽章、真 Cloudflare D1/Queue ACK/DLQ、Store/OIDC/EAS、付費授權未核准；官方 **G00–G10 11/11 BLOCKED**、P05/PUBLISHABLE=false；**沒有真專用 Echo RN App 原碼/真 API/實體資料庫轉移/上架**。

