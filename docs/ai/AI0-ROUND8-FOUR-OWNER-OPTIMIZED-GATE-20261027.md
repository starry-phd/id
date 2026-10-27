# AI-0｜R8 四組實作 × GitHub CI 優化「同 Checkout」整合候選（2026-10-27）

> **離線 Draft；未合併 main、未部署；G00–G10 11/11 Release Gates BLOCKED。**
> 本文只是對來源與整合候選版本的固定依據。任何 GitHub Actions 都必須以本 PR 最終 HEAD 查驗，不能引用各 Owner 已成功的其他 SHA 當成本整合 CI 成功。

## 本輪固定來源
| Owner | 原 PR | 固定 SHA | 納入變更 |
| --- | --- | --- | --- |
| AI-1 | [#66](https://github.com/starry-phd/id/pull/66) | `d0a20fb0fadeed1fecb2a84fdd88020dfe924a4f` | 7 個 Owner 檔：Q119 刪帳後首註電池防重發放的**隱私核准前預設關閉**候選、刪帳 CAS 和回歸測試 |
| AI-2 | [#68](https://github.com/starry-phd/id/pull/68) | `e3276e64cdf4443bb102bddd7f10db404169d63e` | 4 個 Owner 檔：Q113 後端定期商店對帳／租約 CAS 的**離線候選**與負測 |
| AI-3 | [#69](https://github.com/starry-phd/id/pull/69) | `d5f5b02218b219c0881609e3acbb679aa9e5ca04` | 7 個功能／測試檔：Q114 匿名申訴、Q115 稽核保留，均 **default-off／review-only** |
| AI-4 | [#67](https://github.com/starry-phd/id/pull/67) | `42b1bc0605e5b2066405a1f67677c17197be3ace` | 4 個 Owner 檔：AI 任務成功憑證可信後端 adapter 與 Battery 跨域負測 |

基準為 [AI-0 R8 128 項追溯 #65](https://github.com/starry-phd/id/pull/65) ＋ [GitHub CI 最佳化 #70](https://github.com/starry-phd/id/pull/70)，固定 `abba356ca71530dbc5d38bbd482fe065609c94d8`。此前 R7 [#64](https://github.com/starry-phd/id/pull/64) 四組整合已是此版本祖先。此輪使用 Git Tree 中的**來源 blob SHA 直接批次入樹**，不逐檔產生 Commit；所有加入的原始碼、測試和文件共 **22 個 Owner 檔案**。

**衝突裁定**：AI-3 #69 的第 8 個檔案 `.github/workflows/rebuild-ai3.yml` 僅修改舊版 branch filter，**不覆蓋** #70 已完成的 `concurrency` 優化與最新整合 CI。這項排除是 AI-0 避免 CI 設定倒退的刻意選擇，原 #69 完整保留可稽核。新候選自行由 #70 全量 Gate 重新覆核 AI-3 測試。

## AI-0 新增的跨模組安全檢查
- `packages/integration/test/round8-all-owners-gate.test.mjs` 對四位 R8 真正 TS 模組在同 checkout 做安全旗標／偽造身份證據／跨品牌稽核拒絕負測；不讓 mock 成功變成真正授權。
- 最新 CI `.github/workflows/ai0-current-offline-gate.yml`、GitHub [SOP](../operations/AI-DEVELOPMENT-SOP-20261027.md) 全部來自 #70；所有測試只用 Node/SQLite memory/Workers **dry-run**。
- 本整合需要核實所有原始程式 blob SHA 對應完全一致、同一最終 HEAD 所有 GitHub Actions completed/success，才允許宣稱 `R8_OFFLINE_SAME_CHECKOUT_VERIFIED`。

## 未解鎖事項
- Q119 原始 OAuth subject 的 purpose-bound HMAC 去重涉及真實個資權利；合法資料保留、刪除／撤回例外未核可。獨立 D1 的「去重 claim＋電池發放」尚未證明**原子唯一事務**；不可僅靠 read-only preflight 發電池。
- Q113 真 App Store／Play 購買、憑證、Server Notification、官方帳戶、定期 requery 與負向處理尚未真正驗證或啟用；不得發布權益、P05 或 Queue ACK。
- Q114 真 CSPRNG、安全憑證、掃毒與匿名查詢限流、合法隱私儲存及管理 Step-up 未就緒；Q115 留存僅提案且自動清除禁用。
- AI-4 任務真實成功事件來源與 Cloudflare D1/Queues 一致性未驗；Battery X/Y 及費率等尚無正式數值，所有 live writes off。
- 第一款正式 App、實際商店、真 OAuth、D1/Queues、EAS Build、Production、成本審核均尚未獲正式 Gate。

**禁止自行 main merge、部署 Cloudflare、真 Store/OAuth/D1/Secrets/EAS/付費或重新啟動 H-Global。**
