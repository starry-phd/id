# AI-0｜R22 繁星回聲真四組原碼同版整合｜2026-10-28

## 源頭
- 基礎為 R21 真已驗四組 [#148](https://github.com/starry-phd/id/pull/148) `fbd5c03156da700b68c7b5bceb65269cb7c900ec`。本 PR 的父提交為 AI-0 已驗 [繁星回聲 40 功能產品藍圖 #153](https://github.com/starry-phd/id/pull/153) `80f642b2e5d8a364b409a77d13695b1381713670`；**保留兩者**。
- AI-1 [Auth #151](https://github.com/starry-phd/id/pull/151) `1acfb9106bb1299973aaa53cb4929bafda5ca8c3`：3 個原始 Blob。
- AI-2 [Billing #150](https://github.com/starry-phd/id/pull/150) `9026d228aa5d96eebec07282cf47d4936471e501`：3。
- AI-3 [Task/Battery #149](https://github.com/starry-phd/id/pull/149) `5ba5a9d2a8f34c42504b8e2108f68b6da5be90cf`：4。
- AI-4 [Echo API/View Model #152](https://github.com/starry-phd/id/pull/152) `d07bc4751d8fde3549325fc58bb86b7cbef8c5dc`：3。
- GitHub 各 Owner PR head/files/actions 當輪再次核實；全部以同一 #148 SHA 為 base、各自真 CI successful；AI-0 用 Git Tree 直接引用 **13 個 Git blob object 原樣**，未重寫原始碼，另外只加本紀錄及 1 個 manifest。**不再重做一套獨立的原始 blob 假測**，由 GitHub PR-files Blob SHA + 新 HEAD 現有完整 CI 核實。

## 本輪新東西
- Auth：Echo Guest／Session／Scope，只認新 Starry ID 的可信來源，拒絕 Legacy Token。
- Billing：Echo VIP／解鎖／貼紙與 Store 及永久免費 Battery 安全領域分隔。
- Battery/Task：播放、離線快取、逐字稿與 AI QA 的事件/Wallet Receipt，不可從播放器事件認定扣額。
- API/View Model：Echo 音檔清單／播放器／逐字稿的**私有離線 TypeScript 契約及假資料行為**，不是正式 iOS/Android UI 或真 Cloudflare API 部署。
- 保存 #153 的可追溯 **40 功能、53 舊檔 SHA、P0=18/P1=10/P2=12**；首款 App 已指定「繁星回聲」，但 P0 是建議不是正式核定 MVP。
- 四組同版 Gate 只有**新整合 HEAD 的 GitHub Actions 完整成功**才可稱 `R22_FOUR_OWNER_OFFLINE_SAME_CHECKOUT_VERIFIED`，不可用各自 green 冒充。

## 加速正式上線的最短合理路線（仍需實證）
1. 在新獨立 Echo Expo App 實作**真可執行 Native 視圖**：音檔清單→搜尋→詳情→播放器→可行時的本機假資料演示；原生背景播放/離線需要真機驗收；先不要把假媒體/假登入稱 live。
2. 業主確認實際第一版 MVP/公開音檔權利／Auth/舊資料是否完全重建/新 repo/Bundle IDs/商店身份；用 Echo 40 功能矩陣快速選取。
3. 正式 Cloudflare 及安全里程碑：Echo D1/R2 與 Starry ID 身分授權、跨 D1 架構 (#87)、P05、法律 Q104/Q119、KMS/HMAC、獨立不可回退 witness，才能申請真正 Staging/Production 資源及有界成本驗證。
4. Apple/Google 登入/Store/EAS/法定文件/Store 截圖、實機和正式版本安全驗收，G00–G10 十一 Gate 各自有真正 release 證據後才可發布。

**絕對不把此次 local SQLite/Node green 當成真 Cloudflare 跨 D1 原子性、已建正式 App 或已上架。** 本 PR Draft；正式 P05/PUBLISHABLE=false、G00–G10 11/11 BLOCKED；不 merge main、未經核准不 Preview/Staging/Prod、不接真正 D1/R2/Queues/Secrets/Store/EAS、零費用、H-Global 暫停。
