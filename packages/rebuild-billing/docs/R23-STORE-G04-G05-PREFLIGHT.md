# AI-2 R23｜G04/G05 真 Store / Billing D1 發布前來源預檢

狀態：**程式存在 + 離線驗證候選**；**沒有 verified_live，沒有上線批准**。來源：Issue #156、AI-2 #3、AI-0 #164 (四 Owner 同版) 與 #165 (Cloudflare 事故)，正式 release-readiness.v0.json 的 G04/G05 仍為 BLOCKED。

## 本輪實作
- src/r23-store-release-preflight.ts：讀實際 Repo Gate JSON，檢查 11 個 G00–G10、G04/G05 AI-2 擁有權、release authorization=false；讀 Wrangler 有效 TOML D1 宣告（不是 Cloudflare API）；查原 SBASE BillingClient 仍 default-OFF。輸出固定可審計缺口清單；不接受自填 manifest 的 verified=true 或 URL 為官方 Store 憑證。
- scripts/r23-store-preflight.mjs：對目前 checkout 的三份既有真檔執行，不讀環境變數/Secrets/會員資料，不連網，JSON 僅固定缺口代碼。指令：node packages/rebuild-billing/scripts/r23-store-preflight.mjs --assert-blocked。Gate 格式安全且仍 BLOCKED 時 exit 0，變更／缺失時 exit 2；--require-live 一律 exit 3，不能冒稱已驗真 Store。
- test/r23-store-release-preflight.test.mjs：測試真正讀檔、Gate 篡改、假 Store 簽章/連結、D1 TOML 註解/假存在、Release 自行批准、CLI Exit、資料不外洩。

## AI-0／DEV-B／AI-4 下一步及需要的真證據

| Gate | Repo 可以驗證 | 正式仍缺 |
| --- | --- | --- |
| G04 Apple | 只有離線候選契約 | 官方 Apple x5c 信任鏈/驗簽、Sandbox 簽署通知與真 refund/restore |
| G04 Google | 只有離線候選契約 | Google Play API/RTDN 正式可信來源、測試訂單、退款/亂序/續訂 |
| G04 商品 | SBASE candidate SKU 不可出售 | 每 App 真 Bundle/Package、SKU、環境、售價、單一 RevenueCat 或自建權威 D-03 核准 |
| G05 D1 | Repo staging Wrangler 無 Billing D1 Binding | 獨立受核准真 D1 / first-claim / CAS / outbox / ROLLBACK + PITR |
| 跨域 | R19/R20/R21 離線回讀 | AI-1 lawful Q104/Q119 HMAC/KMS，AI-3 P05 signed / Queue ACK-after-commit / durable floor |
| Release | G00–G10 11/11 BLOCKED | AI-0 人工批准及各項真雲端／Store／原生實測 evidence |

Preflight 無任何授權付費成功路徑；沒有 IAP SDK、Store key、真 R2/D1、Worker/Queue 部署、EAS 或付費 Service。使用者取消/退款/恢復/刪帳、跨 App 或跨品牌授權，不得從模擬狀態提升；免費 Battery 永久不能當 SKU。CLI 不驗 Apple/Google 真簽章、不接真正 Cloudflare，也不能保證網域或運作環境安全；其安全成功代表「目前仍被正確封鎖」，不是可以部署。Cloudflare #164 preview failure 由 AI-0/AI-4 處理，本組不改 Trigger、不重推 #164。

Rollback：關閉 Draft PR；無正式 schema migration、原有程式覆寫、金流、真資料庫、main merge 或正式部署。
