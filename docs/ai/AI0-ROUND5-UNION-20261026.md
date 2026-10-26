# AI-0 第五輪四位 Owner 與 AI-0 上線 Gate 同 Checkout 驗收候選

日期 2026-10-26；前一整合 #46 `bacc0166bf4e1070a4696c7bc109197b4c642f9f`。
- AI-1 #49 `43b924c87b186ae327be347f699553d628a29483`。
- AI-2 #51 `a8ff6bd67980a302e56de5b5c4ee9f62796fa974`。
- AI-3 #47 `1591089fd1668f8787d24088859fe5544f352a2a`。
- AI-4 #50 `2c3c3c7ccc7404a477da85bf457e6087c2362448`。
- AI-0 #48 `e17d9cbafea21dae1ddd15cb6ead0e22294e170f`（11 道上線驗收 Gate）。
- 5 組 30 個路徑無重疊，原 Owner PR 保留 Draft，不修改其個別工作枝。

## 唯一正確驗收範圍
- 每位 AI **最新程式原檔**一起測試，不依賴原本各 PR 的成功 CI 宣告總整合成功。
- AI-1 OIDC callback/PKCE/CAS、AI-2 Apple x5c / Play offline trust candidate、AI-3 D1 Queue fault handling、AI-4 全域離線端到端 Worker/SDK/Store 稽核。
- AI-2 與 AI-3 各新增與**最新 committed Billing D1** 的測試，可能有上一輪 before-commit retry/quarantine 的契約差異；任何一項差異都應保留失敗證據並由 AI-0 明確裁決，而非 skip。
- AI-0 11 Gate 的 `release: BLOCKED` 屬**預期正確**，其 CI PASS 表示封鎖有效，不是可以 deploy。
- 25 Seed 與原始 128 題尚未全部業主核准；Starry/H-Global 分離，P05 `billing.p05.v1-candidate` 不得啟用 Production。
- Apple test self-signed root 不是官方 Apple 官方 PKI 或 OCSP 實測；Google API mock 不是真正 Play 商店；offline D1/Queue-shaped ports 不是實體 Cloudflare。
- 真實 D1/Queues、OAuth Callback/官方 JWKS、Store Sandbox、iOS TestFlight/Android Play internal、EAS 原生實機、安全部署 Gate 仍 BLOCKED。
- DEV-I 最新 Expo/EAS 免費成本規則：每 PR 保留 CI、不自動 EAS 雲端原生 Build、不擅自啟用付費。
- 本 PR 只進行 GitHub Draft 和唯讀 CI；**禁止** merge main／staging/production 部署／付費／正式 D1/Queue/Store/Secrets。
