# AI-4｜Wave1 Round-001｜中央 Worker／OpenAPI 實作一致性、Cloudflare Workers Build 唯讀事故與 D04 Ads 三家研究

> **2026-10-28，AI-4 DEV-G/I。** 依 [AI-0 四組共用啟動令](https://github.com/starry-phd/id/issues/1#issuecomment-6466488372)、[AI-4 正式 Round-001 派工](https://github.com/starry-phd/id/issues/5#issuecomment-6466187946) 與 [AI0 Wave1 工作令](https://github.com/starry-phd/id/blob/506e33d68a2b2a069b5a356c0bf4192df7db7463/docs/ai/AI0-WAVE1-EXECUTION-HANDOFF-20261028.md) 實作。標記：**code_exists / verified_offline（待新 SHA CI） / verified_live=false / publishable=false**。本檔只包含公開安全的診斷紀錄；不得以本輪成果解鎖正式 Gate。

## 1. 來源基線與真實可重現開發命令

- 新分支依據 AI-0 Round-001 [Draft PR #186](https://github.com/starry-phd/id/pull/186) **固定 HEAD `506e33d68a2b2a069b5a356c0bf4192df7db7463`**。這份 AI-0 分支保存 D01=D、Q1～Q5 決策帳本與五 Owner Wave1 工單，**未合併 main**；不是視舊版 D01 待選為新決議。
- 實際原始依賴：`apps/mobile/package.json` Expo `~54.0.20`／RN `0.81.5`／Expo Router `~6.0.13`；根 `package.json` 為 npm workspaces、Node >=22、TypeScript、ESLint、Wrangler；`apps/api/src/index.ts` 只有真 `GET /v1/health`，拒絕正式環境、非 Starry App、其他路由及動詞；`apps/api/openapi.yaml` 是 OpenAPI 3.1.0 且只宣告 liveness。**沒有正式 Auth/Billing/Battery HTTP endpoints，不得寫假的 SDK 已可用。**
- 本次新增的**真 TS contract checker**：`apps/api/src/wave1-worker-openapi-parity.ts`，對當前唯一已實作 liveness route 的 OpenAPI 3.1.0 路徑／method／schema 與**實際 `handleRequest` Response** 進行比較，禁止偷偷新增宣稱可用的 Auth／Billing／Battery／Admin 路由、漏掉 `no-store`／`nosniff`、放行跨品牌／production 或錯誤動詞。所有回傳的 Live/Publish 權限恒 false。
- 新 `apps/api/test/wave1-worker-openapi-parity.test.mjs`：10 個新 Node 契約／負測；讀**當前 Repo 實際 `apps/api/openapi.yaml`**，直接調 `apps/api/src/index.ts` 的 `handleRequest`。本工具刻意只是目前有限 schema 的 **保守語義守門員，並非通用 YAML/OpenAPI 3.1 validator 或 SDK codegen**。未來當 AI-1/2/3 核准具體 route/source 後，AI-0 須先審查唯一 Auth/Store/Battery Writer，再版本化 OpenAPI、新增真 route＋端對端測試；不得讓此工具盲目放行新敏感 route。

**在原 Repo 的可重現命令（由既有 workflow 執行，這裡沒有自行執行部署）：**
```sh
npm ci
npm run typecheck
npm run lint
npm run test
node --experimental-strip-types --test apps/api/test/wave1-worker-openapi-parity.test.mjs
npm run ssot:validate
npm run mobile:config
npm run api:check             # Wrangler --dry-run only; NEVER run deploy
```
**P01/P02/P07/P09/P10**：驗 App／brand／env 邊界，限制 OpenAPI 明示已實作 route，健康=存活非 readiness、禁止洩露授權資料，透過 PR SHA/CI/Build ID 保存佐證，正式部署／成本／Feature Flag 權限維持 OFF。P03/P04/P05/P06/P08 由 Owner 端正式授權/規格決定，不在本輪憑空產生。

## 2. Cloudflare 真唯讀查核：此回合新增最新失敗 Build

**Cloudflare Starry 帳號之正式 GET-only Build API（2026-10-28）**：
- Worker `id-starry`、Build UUID **`3e420ca9-b786-4851-b4d2-35cd245d20d8`**，`created_on=2026-10-28T10:26:00.650Z`、`stopped_on=2026-10-28T10:26:35.687Z`，**`build_outcome=fail` / `status=stopped`**。後端日誌已實際讀到，不是 GitHub PR CI 推測。[Cloudflare Dashboard Build 紀錄](https://dash.cloudflare.com/?to=/9ff1b4c261141730ac2fe0683f730062/workers/services/view/id-starry/production/builds/3e420ca9-b786-4851-b4d2-35cd245d20d8)。
- Cloning、`npm clean-install` 成功（845 packages）；Build command 為 `npx wrangler preview`、Wrangler **4.152.0**，失敗日誌具體：**`Your Wrangler configuration is missing a previews block to run this command`**。這仍是**Cloudflare Preview 建置設定／配置尋址問題，不是 TypeScript 或 Github offline CI 的失敗**。沒有讀取或記錄 Secrets/Token/生產資料，也沒有修改 Cloudflare Trigger、Worker、部署或其他帳號；不把這次失敗推定為所有 Cloudflare 服務故障。
- 同一 Repo 根目錄**沒有** `wrangler.toml`，`apps/api/wrangler.toml` 的 development/staging only TOML **無** `[previews]`，故裸 `wrangler preview` 不符合現設。官方 Worker Previews 需 Wrangler >=4.135.0，且在 config 定義 `previews` block；此回合實際 Build 的 4.152.0 已滿最低要求，**真正直接錯因是缺 block／配置解析**。
- 之前 [R23 AI-4 #166](https://github.com/starry-phd/id/pull/166) 已完成安全 Preview 靜態 preflight，AI-0 選 **A：保留既有 `id-starry` Trigger 不動**，不得 Push 被監視舊 #164 branch；方案 B 隔離新 Worker／branch／Access／費用 PoC 必須另取得業主對具體操作的明確授權。**本輪不重複 #166，不加入 Preview 設定、不改 Cloudflare Build。**
- GitHub Check 與 Cloudflare 狀態需分開：GitHub 同 SHA Actions `completed/success` 不能取代 Workers Builds；Check Run 尚未更新時以 Cloudflare GET 取得之 Build 最終狀態交 AI-0 核對。

**下一個安全驗收路徑**：AI-0 提供取得核准的**隔離** Cloudflare Worker／branch filter／根目錄／Preview config 路徑／Access 保護／綁定隔離／成本與回退清單，先逐項審查再啟動任何實際 Build。未知 Q104/Q119、#87 P05 唯一權威／真 D1/Queue 都保持 BLOCKED；不得將真正 Session／Store 憑證或正式 D1 寫入 Preview。

官方資料：[Cloudflare Worker Previews](https://developers.cloudflare.com/workers/previews/)；[Build 設定與 Root Directory](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

## 3. D04=C、Q4=D：三家 Ads Mediation 只做技術比較，Provider 未核准

| 研究點 | Google AdMob Mediation | AppLovin MAX | Unity LevelPlay |
|---|---|---|---|
| 官方／整合入口 | `react-native-google-mobile-ads` 提供 Expo config plugin；原生 App ID 與重新 native build 必要；Expo Go **不支援真廣告原生程式** | 官方 `react-native-applovin-max` React Native 模組；v9 已提供 RN 新架構相關支援資訊 | 官方 Unity LevelPlay React Native Plugin，文件明載 RN >=0.66 與 iOS／Android 基本規格 |
| 現有中央 Expo54 | **未安裝、未實際建置**；不應往中央 ID 加 Ads | **未安裝、未實際建置**，需 Expo prebuild/config 方式審核 | **未安裝、未實際建置**，需 Expo／原生依賴檢查 |
| 未來新消費 App Expo 最新穩定 | 官方 RN Mobile Ads 有 Expo config plugin，但**Expo58 配套尚無實際真機 Build 證據** | 有 RN module，不等於 Expo58 已通過；須確認 config plugin、Android Gradle/iOS Pods 及 new architecture 的版本矩陣 | 有 RN plugin，不等於 Expo58 已通過；須核對 Android Kotlin、Xcode/iOS deployment target 與 Adapter 相容 |
| Banner／Interstitial／Rewarded | 文件支援；本案 Rewarded 尚未決定是否納入每 App | 官方模組有 Banner/Interstitial/Rewarded + privacy 模組；候選 | 產品支援跨 ad network mediation；具體尺寸/format/Network Adapter 一律等真 SDK驗證 |
| Consent/隱私/追蹤 | UMP/ATT、GDPR、平台 Disclosure、兒少與地區政策須評估；不代表某項追蹤一律有法源 | SDK 的 privacy／consent 調用、ATT/UMP 互動與多 Network 信號需驗，不能依預設值推定合法 | 各 mediation network 的 consent/ATT 及 SDK/adapter 隱私聲明逐項查核 |
| 變現收益/費用 | 無用戶基數、國別、填充率、eCPM、費率與真 A/B 數據時**無法公允排名** | 同左；多 network 競價不保證一定高收益 | 同左；多 network 廣告來源管理不保證最高收入 |
| 上線 Gate | **OFF**，需 D04 廠商最終選定、D06 每筆新增花費核准、D07 per-App no-ads 真 Store entitlement、雙端 native/法遵驗證 | 同左 | 同左 |

**本階段不選單一廣告商**，不造假「收益排名」、不填未查核的固定費用。建議未來 AI-0 以實際 App 的 iOS/Android build 成功率、Package/SDK 新舊架構、Ads request latency、啟動崩潰、Consent/UMP/ATT 條件、Region fill/eCPM、成本、Store Policy 合規、回退/SDK 版本維護費建立對比實驗；每 App AdUnit/Entitlement/廣告關閉獨立。Battery 永遠免費、**不能透過 Rewarded／Store 變成可販售商品**。比較不是上架核准。

**引用（以廠商當期官方來源驗真，不是本 Repo 的真機成果）**：
- [React Native Google Mobile Ads／Expo Plugin](https://docs.page/invertase/react-native-google-mobile-ads)、[Consent](https://docs.page/invertase/react-native-google-mobile-ads/european-user-consent)
- [AppLovin MAX React Native integration](https://support.applovin.com/en/max/react-native/overview/integration)
- [Unity LevelPlay RN plugin integration](https://docs.unity.com/en-us/grow/levelplay/sdk/react/plugin-integration)

## 4. 尚未通過的正式條件／跨組下一回合

- **AI-0 Gate 1**：核實新 AI-4 OpenAPI test 是否可加入 #186 後續整合，同版完整 CI；不能把 #186 自己的 GitHub Actions Pass 代表新分支 Pass。新 Decision ledger D01=D、Q1～Q5 不能被舊 #186 pending 文本逆轉。
- **AI-1 #2**：由唯一 Auth Owner 發布真正已批准的 AuthClient/session DTO/權限後，AI-4 才可拓展 protected OpenAPI routes；目前舊真 R23 signer/sql 邊界只 offline，未變公開 API。
- **AI-2 #3**：RevenueCat thin BillingClient per-App+Q1 同 App跨 iOS/Android 方向、Q2 購買前登入、Q3 僅 non-consumable＋月／年自動續訂；Store Sandbox 仍需明確授權，不能增開私有 SKU/權益。
- **AI-3 #4**：FREE-only BatteryClient/Queue/Audit Versioned DTO、禁止跨品牌與 Rewarded 賣 Battery；真正 Queue/D1/Audit 回復需 Owner + AI-0 審批。
- **AI-4 Round-002 最小候選**：AI-0 審完路由/SDK Owner 合約後，對契約版本與拒絕行為擴充 OpenAPI type-boundary（不提供憑空自動正式 endpoint），並將 Cloudflare trigger/Build 最小修正規劃列待授權清單；除非明確取得事先許可，不嘗試修復 Live Preview。
- **正式 Gate** G00–G10 **11/11 BLOCKED**、P05/PUBLISHABLE=false，`release_authorization.granted=false`。本次無 main merge、新私有消費型 Monorepo、EAS/Native Build、新 SDK 安裝、真 Ads/Store/RevenueCat、正式 Cloudflare Preview/Staging/Production、真 D1/Queue/Secrets、付費/H-Global。

**回退**：只需關閉本 Draft PR，新測試及報告不曾更動 live service 或舊中央代碼；不可用本回合離線綠燈宣稱 production 安全。
