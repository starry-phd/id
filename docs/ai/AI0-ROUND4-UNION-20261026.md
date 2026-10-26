# AI-0 第四輪全組整合候選與 Gate（2026-10-26）

基線 AI-0 #40 `6d7c54e8c8eecdde810a83932ac9f6bc6fee53fd`。本次只納入完整固定 SHA 的 AI-1 #41 (`fc090467b9438f8133b7934d9681254d51b5f6f5`)、AI-2 #44 (`a3f174ee56e45077b986a38bfc077fa6bd238cd2`)、AI-3 #45 (`92c597d06bdb28b7eb6978f8a3c9d926553af1b4`)、AI-4 #42 (`ea340b42e1fcd1c50b131b842ad2c3e961060b04`) 與 AI-0 #43 (`7e5046f815c2709835c1578f4a2276bebbce40c5`) 的 37 個不重疊檔案。

**此文件與 CI 只證明候選整合，不代表正式上架、真實付款、真實 OAuth 或已執行 D1 migration。**

## 交叉驗收
- AI-1：JWKS cache/rotation、同品牌與 app 的 server session 及 D1 CAS 模擬。
- AI-2：Store Sandbox 驗證 PORT 候選、Billing D1 transaction/CAS/outbox、committed reader 模擬。
- AI-3：Queue ACK 只在 Audit D1 原子 inbox/audit 或可持久隔離後；retry/DLQ 模擬。
- AI-4：受保護 Worker/SDK、HMAC signed Session 和 D1-shaped 負測試、EAS Free 成本政策。
- AI-0：13 欄 `billing.p05.v1-candidate` 僅為候選 metadata-only transport；AI-3 內部 Audit schema 版號不相同且不能混用；validator PASS 並非 provider/source authority。

## 持續阻塞
- Gate 0 仍僅 25 個新版 seed，128 個來源標題未完成逐項人工核准。
- Apple 官方 PKI x5c chain/撤銷查核、Google 真實 JWKS/Play API/RTDN 網路，Apple/Google OAuth 回呼及真正商店 Sandbox 消費尚未驗證。
- 沒有真實 Cloudflare D1/Queues 多 Worker、迁移／備份／原子性／延遲複寫演練，沒有 Production/Preview；Worker 正式入口目前僅 public /v1/health。
- P05 工程候選不等於業主核准發行版本，**不可**因此啟動 Queue publish、收費、發放付費權益。
- DEV-I 最新 EAS Free 規則：保留必要 GitHub CI、不每 PR 自動 EAS 原生編譯，必要原生實機驗收不能省略，任何付費須先業主核准。

所有 PR 仍 Draft，不修改主分支，不部署、不配置 Secrets、不建正式 D1/Queue、不下真實訂單、不執行 EAS Build。
