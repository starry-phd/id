# AI-0｜R21 四組候選 App 狀態契約原始碼整合（2026-10-28）

> **只代表四組原始碼在同一離線 checkout 可編譯／測試，不是正式 App UI、Cloudflare 部署、跨 D1 原子交易或簽章／Store 權威已通過。**

## 正式可追溯基準
- 新整合以 [AI-0 R20 四組同版 Draft #143](https://github.com/starry-phd/id/pull/143) 固定 SHA `e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb` 為唯一起點，保留 R18–R20，以及 #130 App Portfolio、#136 12 畫面候選 UX、#140 F0 研究提案。
- 四個 R21 獨立 owner branch 都基於同一 #143 SHA，事前真正讀取 GitHub PR/files + individual-head Actions，均 `completed/success`；**只能在 AI-0 新 R21 exact SHA 完整 Actions 全綠之後稱 R21 同版驗證完成**。
- AI-1 [Auth #144](https://github.com/starry-phd/id/pull/144) `0576cc57ac6bba0c384795fb72abb5092a7ac359`，新增 **3 個原始 Git blobs**，Auth／Session／刪帳的候選 UI fail-closed 投影。
- AI-2 [Billing #145](https://github.com/starry-phd/id/pull/145) `d7070efe70992db1363976c1fe4977731dee30dd`，**3 個原始 blobs**，付費候選狀態／Store 權威欠缺與免費 Battery 隔離。
- AI-3 [Task/Wallet #146](https://github.com/starry-phd/id/pull/146) `21da5c7a8b271e593746234eb785490d51ad14e4`，**4 個原始 blobs**，任務／電池暫停、未知、收據不一致、PITR 安全條件。
- AI-4 [Private API #147](https://github.com/starry-phd/id/pull/147) `9d0888660d0a8a873b07d13832f5c3cda8645978`，**3 個原始 blobs**，12 畫面候選 App 狀態 resolver。AI-4 在其獨立 PR 明言 R21 Owner DTO 尚不在當時 checkout，所以缺失欄位是 `missing_adapter`，**不可把同版匯入後的檔案存在宣稱已完成所有 R21 真跨模組正向綁定**。
- AI-0 用 Git Tree **直接放入共 13 個原始 Git SHA Blob**，不改 Owner 一字，另寫 4 個 AI-0-only 文件／SHA manifest／Git 原始位元檢查程式／負測。於 GitHub Actions 的**新整合 SHA** 逐檔計算 `sha1("blob " + bytes + NUL + 原始位元)`，拒絕偷換原碼／少檔、宣稱真權限或 release。
- 四 Owner 各自新增驗證的真正 DOM 狀態／資料安全演練在新同版完整 TS、Node、Python :memory: SQLite、128 原始 SSOT、Expo／Worker **dry-run** 下重新執行。這仍不等於真 iOS/Android 介面實作、真 App Store 上架或真 Cloudflare 端到端驗收。

## 「繁星回聲」首款 App 的最新使用者決議 — 和舊候選規劃相區別
使用者在同一專案最新明確指定**第一款要開發的 App 名稱是「繁星回聲」**，來源 [yukidu/Echo-Starry](https://github.com/yukidu/Echo-Starry)（舊 React + Vite Web）。其功能／音檔播放／逐字稿／AI 問答可作**需求參考，採 React Native + Expo + Expo Router + TypeScript 混合技術新開發**，審閱再選擇性繼承純 TS 演算法和合法素材；絕不直接複製舊 Auth、Web DOM、瀏覽器 CacheStorage、Worker 真 D1/秘密和環境設定。

**這份 R21 仍沿用 #136 的通用「候選 consumer AI task」UI 安全規格作 fail-closed 介面測試。** 已知道第一款是繁星回聲，但**未**因此把舊候選的 AI 任務實作／正式產品上市計畫／實際 App Identity／MVP／市場研究或正式 X/Y 費率，自動變更或聲稱通過。等 AI-0 後續整理 Echo 舊功能映射與明確 MVP 方可建立真正 Echo App routes/SDK。最新產品決議在 [Issue #125](https://github.com/starry-phd/id/issues/125)，R21 四 owner 原碼不得為了這件事回頭重改。

## 仍完全封鎖
#87 physical A/B 跨 D1 架構沒有由業主裁決、Q104/Q119 法律 retention/HMAC/KMS、唯一 signed P05 Auth issuer、獨立 rollback-resistant witness、真 Cloudflare D1/Queue ACK/DLQ、真 Store/OIDC/EAS、費用以及正式手機 App identity 均無批准。沒有發布／購買免費 Battery／重發權益／Queue ACK／真任務成功的權威資料。G00～G10 **11/11 BLOCKED**、P05/PUBLISHABLE=false；所有 PR Draft/unmerged、無 main merge、Preview/Staging/Production、真 D1/R2/Queue/Secrets/Store/EAS、付款或 HGlobal 工程。
