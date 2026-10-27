# AI-0｜R11 受控 Staging 準備清單（只讀規劃，2026-10-27）

**狀態：PREP ONLY，不建立環境、不部署、不啟用付費。** R11 四位 AI 繼續在獨立分支開發；以已驗 [#82](https://github.com/starry-phd/id/pull/82) 為本文件參考基準，真正新整合須重新讀最新 PR。對應 [跨 DB 架構 ADR](../adr/AI0-R11-CROSS-D1-CONSISTENCY-20261027.md) 與 [11 Gate 證據差距](../release-readiness/AI0-R10-EVIDENCE-AND-DECISIONS-20261027.md)。

## 目前可獨立完成的事項（不需真環境）
- [x] AI-0 R10 單一 SHA 離線驗收 3/3 Success（不能宣稱 R11 已通過）。
- [x] G00～G10 11/11 `blocked`、發布批准 `false`、自動部署 `false`，以 Release JSON 為準。
- [x] 首註贈送／任務扣抵／恢復跨資料庫選項比較已提出，**未裁決**。
- [ ] 整理真正 Starry 專用 Auth、Gift claim、Task、Wallet、Audit、Store outbox 的**邏輯寫入權威清單**，不填造不存在的實際 Cloudflare 資源名稱。
- [ ] 先以合成資料設計事故演練：刪帳／Session revoked、首次贈送重試、雙重錢包結算、store refund 亂序、P05 重播／Queue ACK 丟失、PITR 復活、隱私刪除衝突。
- [ ] 提出第一個真正上架 Starry 消費端 App 的候選與 Apple/Google 包名；**未經業主決議不得建立 Store Listing/SKU**。
- [ ] 對 Q104、Q119 的合法資料保留與刪除/撤回方式提出法遵審閱問題，而不是默認 HMAC 指紋無個資風險。
- [ ] 雲端、Store、EAS 免費額度/成本/現有用量**需真帳單或官方當期證據**；無來源記 UNKNOWN，不自填金額、不可承諾零成本。

## 必須另經業主授權之後才可實際觸碰的項目

| 將來擬做的事 | 真實核准與前置條件 | 未經批准前的替代 |
| --- | --- | --- |
| Cloudflare Staging／D1／Worker | 專屬資源 owner、隔離/Secrets 最小權限、限額、rollback、獨立批准 | TypeScript/SQLite、Wrangler dry-run |
| 真 OAuth／Store Sandbox | 官方開發者帳號、Bundle/SKU、Sandbox 憑證、合法測試身分與金流權限 | 無真密鑰的 mock 與負測 |
| Cloudflare Queue/DLQ、P05 | 正式事件 schema、commit-before-ACK、idempotency、DLQ durable receipt、配額 | P05 candidate 與本地重試/重播模擬 |
| PITR／獨立受保護備份恢復 | 合法保留、不可回退獨立見證、審閱員 step-up、審計和反復活逐筆驗證 | read-only review，`may_restore=false` |
| Expo/EAS 真原生裝置／App Store | 第一款消費 App、Bundle ID、商店帳號、EAS 額度、授權成本 | Expo config 與 Node/CI 離線 |
| 第二波中央管理中心 | Starry 專責獨立後台範圍正式立項 | 第一波僅 ADMIN-PREP P01～P10，H-Global 不啟動 |

## 環境、身份與資料安全
- **絕不把真會員個資、OAuth subject、匿名申訴憑證、Store Receipt、密鑰、Cookie、真付款資料放進公開 GitHub、測試日誌或 Issue。**
- Starry 與 H-Global 的 Auth、管理員、Secrets、真 D1 與金流必須分離；同一帳號代管不等於可互用資料。
- 新環境如將來獲准，也只應採最小權限、明確成本、獨立審核及可驗回滾，禁止在本文件成立時就自行動作。
- 人工決策未知時保持 `BLOCKED`、`UNKNOWN`、`NONE`，保留可核實的 URL／SHA，不將 GitHub CI success 視為商店或 Cloudflare 部署結果。

## AI-0 下一輪交接格式

```text
相關 Gate / 狀態：
真權威的來源 URL / 證據種類（缺時 NONE）：
AI-1～4 最新 PR 與固定 SHA：
跨 DB 寫入責任與失敗/補償 owner：
正式環境操作授權 URL（缺時 NONE）：
成本上限/免費額度及真使用量來源（缺時 UNKNOWN）：
實際同 SHA GitHub Actions 與負測：
不可解除的 blocking items：
```

**只有經另外授權、具真實證據的安全 Gate 審查才可能進入受控 staging。此次無 main merge、真 DB/Store/EAS/付費或 H-Global 開發。**
