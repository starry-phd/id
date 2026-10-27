# 繁星回聲｜Expo Native First Slice（DEV ONLY）

**實際新碼**：一個獨立可啟動的 React Native + Expo Router 原生／Web 導覽展示。這不是舊 WebView；也不是正式上架的版本。

- 來源：業主已指定首款 App 為「繁星回聲」；舊版 [yukidu/Echo-Starry](https://github.com/yukidu/Echo-Starry) 僅當功能規格，不讀任何真雲端媒體與個資。
- 上游：[AI-0 R22 原始四組整合 #154](https://github.com/starry-phd/id/pull/154)，另保留 [AI-0 繁星回聲 40 功能矩陣 #153](https://github.com/starry-phd/id/pull/153)。
- 本地示範：`app/index.tsx` 音檔清單／搜尋、`app/track/[id].tsx` 詳情、`app/player/[id].tsx` 不假裝播放的播放器畫面、`app/about.tsx` 安全說明。只有 3 筆**虛構**假資料，`mediaUri:null`；沒有授權音源時播放與離線按鈕真實 disabled。
- 不把 `apps/mobile` 原有 **Starry ID DEV** 程式當成 Echo App。此專案放在 `examples/`，**不加入正式 monorepo workspaces/CI 部署，沒有 Apple/Google App IDs 或官方 EAS 帳號**。

## 本地操作（獨立開發者測試）
```bash
cd examples/echo-native-dev
npm install
npx expo start
```
使用 Expo Go/模擬器或 `w` 開 Web，需自行檢視 Expo SDK 和測試裝置的相容版本；**尚未在 iOS/Android 真機實測，沒有執行 EAS Build**。本版本 UI 沒有真音源，不能誤稱原生背景音訊已完成。

## 必須完成才能推向正式產品
- **先核實** Echo 首次 MVP、音檔著作權/公開與會員權限、真 API/合法內容、Apple/Google Store 帳號、Bundle ID。
- 用官方 [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/) 實作真授權媒體播放／鎖屏／耳機與背景音訊，真機驗證；用 [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/) 處理可撤銷和清理的離線音源，不移植舊 CacheStorage。
- Starry ID 新版 Auth 審核；Echo 新 Workers 專屬 D1/R2/Queue 在經核准的隔離環境才進行真正串接與成本控制。
- Release G00～G10 11/11 BLOCKED；P05/PUBLISHABLE=false、#87 跨 D1 A/B、Q104/Q119、HMAC/KMS、獨立不可回退 witness、Store/OIDC/付費及真機 Gate 均未放行。

**無真 App 上線、無 main merge、無任何 Preview/Staging/Production、無真 Cloudflare／Store 操作、無付費、HGlobal 不參與。**
