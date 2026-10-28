# SBASE-20261028｜AI-0 技術基座相容 ADR（候選／待 PoC）

> 僅記錄使用者已授權的五組 GitHub 分工與 v1.0 **候選**技術差異；不等於已批准套件升級、雲端部署、付費或上架。

**主控任務**：[Issue #156](https://github.com/starry-phd/id/issues/156)。來源：2026-10-28《Starry 生態系共用技術基座與 AI 開發前交接包》v1.0 候選版。中央服務既有已核准業務規格，優先於 App 平台候選方案。

## 實際 GitHub vs 技術候選

| 領域 | 目前已讀原碼／Repo | v1.0 候選 | 結論 |
|---|---|---|---|
| React Native/Expo | RN 0.81.5、Expo 54、Expo Router | RN 0.88、SDK 58 | 保留原成果，需原生插件 iOS/Android PoC 才升級 |
| TypeScript | Strict + Worker TS | Strict | 保留 |
| Workers / API | 原生 Request/Response；OpenAPI 3.1 草稿；公開路由僅 /v1/health | Hono/Zod、OpenAPI 3.1、openapi-typescript/fetch | AI-4 在隔離 PoC 測；不假冒已有其他正式 API |
| Repository | 公開 `starry-phd/id`、npm workspaces；main 僅 scaffold，大量中央功能在 Draft PR | 私有 Starry pnpm/Turbo 多 App Monorepo，或 SDK Repo + 多 App Repo | **重大 ADR 衝突**：不可直接改現有中央 Repo 或上傳私有程式 |
| Auth | AI-1 已有離線安全候選；未接正式 issuer/D1 | 每 App 版本化 AuthClient 插槽 | 保留唯一 Starry ID owner，不重寫 DB |
| Battery | AI-3 已有免費制度及離線復原候選 | BatteryClient 插槽 | 保留 Starry 專屬永久免費；不得售賣或直寫 D1 |
| Billing | AI-2 自建 Apple/Google Store 信任候選；真商店證據不足 | RevenueCat 優先比較 + BillingClient | 不雙重購買權威；先 ADR/PoC，不觸真 Store |
| Ads | 無正式 AdProvider | AdMob、UMP/ATT、去廣告 | 新技術候選，先 Adapter；每 App 使用自己的正式商品和 Ad Unit |
| App Factory/EAS | 尚無真正 30-50 App 工廠與真 sandbox builds | Manifest/Factory/canary/受影響 CI/EAS | AI-4 分層 PoC，未核准不可執行付費建置或正式送審 |

## 五組唯一寫入者／任務

- **AI-0**：保護中央 Release Gate，維護相容 ADR/候選版狀態、Issue #156、跨組契約和 GitHub CI 証據；本 Draft PR 是第一份成果。
- **AI-1**：AuthClient 版本化 API/型別，管理會話、scope、刪帳、訪客、安全斷線；只允許中央 Auth 真權威驗證。
- **AI-2**：BillingClient provider 比較（RevenueCat／自建）、SKU 隔離、退款、月/年訂閱、買斷及去廣告唯一伺服器權威。
- **AI-3**：免費 BatteryClient、安全錯誤與稽核/Queue/PITR；不新增未經批准的錢包扣額業務。
- **AI-4**：Expo/Router/原生插件、Hono/Zod/OpenAPI SDK、AppRegistry、Manifest/App Factory、AdProvider、CI/EAS 隔離 PoC。

**任務/交接**：每位在自己 Issue #1～#5 取最新 SBASE 派工，在 Draft PR 寫固定 SHA、CI run、哪些候選通過或待決、成本及回退，在 #156 留結果。不需業主轉貼工程交接；但 GitHub 留言本身不會啟動另外四個分離的 ChatGPT 對話。

## D-01～D-08 尚待核定

- **D-01** SDK58 native plugin PoC — CANDIDATE／不得自動批准。
- **D-02** monorepo vs SDK+independent repos — CANDIDATE／不得自動批准。
- **D-03** RevenueCat vs own Store validator — CANDIDATE／不得自動批准。
- **D-04** AdMob UMP/ATT/no-ads — CANDIDATE／不得自動批准。
- **D-05** optional RN Web conflicts with old DEV-I T03 — CANDIDATE／不得自動批准。
- **D-06** EAS/GitHub/RevenueCat/Cloudflare costs — CANDIDATE／不得自動批准。
- **D-07** cross-app subscriptions — CANDIDATE／不得自動批准。
- **D-08** StyleSheet tokens vs UI frameworks — CANDIDATE／不得自動批准。

## 風險與回退

現有 `main` SHA `8be31efb3dfba66755f297b315593e33cdacfe39` 與中央離線 R21 Draft #148 SHA `fbd5c03156da700b68c7b5bceb65269cb7c900ec` 未合併；不得把測試綠燈當正式部署。候選差異不改真 Expo/package lock/Cloudflare/D1/Secrets/Store，不更動 H-Global。正式 G00～G10 11/11 BLOCKED、P05/PUBLISHABLE=false，任何真資源/商店/付費/Production 需要當次核准。此提案可以直接關閉 Draft PR 回退，不影響實際系統。
