# AI-1 W2｜R23 初驗 outcome 型別分類、request-local 故障隔離（OFFLINE ONLY）

- 正式指令：[AI-1 Issue #2 W2/P0 #6489128794](https://github.com/starry-phd/id/issues/2#issuecomment-6489128794)
- 唯一固定基準：AI-0 [#250](https://github.com/starry-phd/id/pull/250) exact `7316ee0f014a01649eea87a62b3ad6cdb6b1febd`，已包含 11/11 W1 Owner blobs、#243–#245。不可重做 W1 或修改原始檔。
- 依賴的原始碼：`src/r23-signed-session-d1-request-boundary.ts`（原始 blob `95f89cae3a436811f9a07fff25a9d4bffc174585`）；`src/session-crypto.ts`、`src/d1-ports.ts` 與 `src/index.ts`。**本 adapter 不重新實作 HMAC、provider／Session 權威、自己查 DB 的第二份 SQL。**

## 精確契約
`createOfflineW2CurrentAuthOutcomeAdapter({enabled?,serverScope,expectedOrigin,authDb,getVerificationKey,now})`：
- default OFF；constructor 直接拒 **production、foreign brand/app、非安全 origin、非法 port**；不註冊 route。
- 每次 `authenticate(request)` 新建 read-only DB 與 key port 包裝層，透過既有 R23 `authenticate(request, trustedNow)` 真實驗簽與 **current Member/Session/provider** 查詢；沒有共享／全域 error Boolean。
- 結果 **三類**：`{status:'verified'}`／`{status:'denied'}`／`{status:'dependency_unavailable'}`（每種固定 `verified_live/may_publish/may_ack/may_grant/may_write_live_d1=false`）。不返回 raw token/subject/SQL/KID/堆疊；結果本身無 `principal` JSON 欄。通過 `takeW2VerifiedPrincipal(result)` 才能取得**原始 R23 server-sealed TrustedPrincipal**。使用 WeakMap 按**成功 outcome 物件 identity**保留真正封印的 principal，假 JSON、複製或客戶端 `verified:true` 無法得到權限。**這個 WeakMap 不是故障追蹤器**，只儲存已成功鑑別且本機伺服器簽章的封印 principal。
- `denied`：格式壞、未署名、未知 kid（`getVerificationKey(kid)` 返回 null）、過期/revoked／失效 current record／provider 不匹配，或預設 OFF。不在後端重試。
- `dependency_unavailable`：trusted clock 不可用或不安全，`getVerificationKey` 拋出/拒絕、DB `prepare/bind/first` 拋出/拒絕。錯誤只寫在該次閉包中，下一個／並行其他請求不受污染。此分類基於**可觀測 port 異常**，不會對未可知的真實外部故障做猜測。
- **Port 的關鍵契約**：未知 kid 正常返回 null；真金鑰存取故障**必須 throw/reject**。目前 R23 將二者皆轉 null，若底層 key/DB wrapper 自己吞例外再回 null，這個 adapter 不能憑空推知是故障。正式 Worker/KMS Port 需 AI-0/AI-4 同意此信號語義。
- DB wrapper 僅允許 R23 的 `SELECT`；拒絕任何 `run`／寫入。沒有原子交易寫、Queue/outbox、事件／會員修改權限；只提供**request-local read classification**，與先前 #244 最後 SELECT snapshot 的 read fence 不等於寫入授權。

## 真實安全負測／限制
測試以 WebCrypto nonextractable ephemeral HMAC 簽真 Bearer，並用 `node:sqlite` `:memory:` 套既有 `001_starry_identity.DRAFT.sql`。涵蓋：封印 principal、已撤權/刪除/版本漂移/解綁拒絕、未知 KID vs port throw、prepare/bind/first 故障、錯時間、兩次並行的 Key 故障與 DB 某 Session 故障不污染另一個成功請求、無重試/私密訊息回顯。**不是 mock HMAC 或捏造 live D1／OIDC。**

## AI-0/AI-4 接手邊界
此設計**不修改 #244 的既有 401/403/503 HTTP wire**；未將 `dependency_unavailable` 私自映射 HTTP 503，也未接現有 Worker。AI-0 應先審查新分類的語義、是否將真 Port outage 與未知 kid 明確分流，再協調 AI-4 的獨立 shared Worker/API/SDK 升版決策。既有 #244 handler/client 保持原狀且後端仍未 Live。D00/D87/D06 已核准方向不等於物理資源、schema、P05／G02/G03 Gate 授權。

**全正式 Release G00–G10 仍 11/11 BLOCKED；P05/PUBLISHABLE=false、release=false**。No main merge、Preview／Staging／Production deploy、真 D1/Queues/OIDC/Secret/Store/EAS/付費、H-Global／繁星回聲。
Rollback：關閉 AI-1 W2 自有 Draft／棄此三個新增路徑，原 #250 與歷史 W1 專責、#244 wire、main 均不受影響。
