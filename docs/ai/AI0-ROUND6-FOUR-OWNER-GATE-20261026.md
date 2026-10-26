# AI-0｜第六輪四組同版本整合／驗收 Gate（2026-10-26）
> **性質：獨立 Draft、離線安全測試，不是 main 合併或上線／付費授權。**

## 固定的上游 GitHub 證據（不可將 Draft 口頭完成視為部署成功）
| Owner | PR | 固定 HEAD | 含入本整合分支 |
| --- | --- | --- | --- |
| AI-1 Auth/Member | #58 | `5f8fdece854633184e97d73da074786bce76d8bc` | **是，本 AI-0 branch 直接從此 SHA 分支** |
| AI-2 Billing | #55 | `966d89274cb4655e4ffa69f30e881bd3e27a1a55` | 是，已透過 AI-0 #57 移入固定來源的 2 檔 |
| AI-3 Audit/Queue | #56 | `acaad9f91dc560d38d5b17fcab6cf85e37f97af7` | 是，已透過 AI-0 #57 移入固定來源的 6 檔 |
| AI-4 Expo/Workers/API/SDK | #54 | `3b9391636b6576f636c331bfcdbdae645680796e` | 是，#57 分支祖先包含 #54 與 DEV-G #53 |

- AI-0 三組過渡整合 [Draft #57](https://github.com/starry-phd/id/pull/57) 固定 HEAD `01ee5bb97988b9da493cd2c8a2727e84f73fbce0`，專責 [CI #40309042865](https://github.com/starry-phd/id/actions/runs/40309042865) success，同 HEAD 15/15 GitHub workflows success；只代表 R6 三組 + AI-1 R5。
- AI-1 第六輪 [Draft #58](https://github.com/starry-phd/id/pull/58) **基於 #57 固定 HEAD**，8 個純 AI-1 owner 檔案。專責 [AI-1 CI #40311158623](https://github.com/starry-phd/id/actions/runs/40311158623) success：Node 71/71、SQLite :memory: 26/26。該固定 HEAD 的 [AI-0 R6 同 checkout CI #40311158660](https://github.com/starry-phd/id/actions/runs/40311158660) success：Node 292/292、SQLite :memory: 87/87，0 skip；同 HEAD 7/7 GitHub workflows success。
- **本 AI-0 四組總整合 Draft 以 #58 固定 HEAD 為唯一新分支祖先**，因此保留 #54/#55/#56/#58 所有原始碼，不複製或更改四位 Owner 原始 Draft。增加專用 `.github/workflows/ai0-round6-four-owner.yml`，必須以本整合 PR 的最新 HEAD Actions 真實結果裁定，不得拿上游 SHA 的 CI 綠燈冒充新 HEAD 通過。

## 本輪 Gate 檢驗必保留
1. AI-1 server-owned Apple/Google issuer、callback/authorize/token/JWKS 白名單、test-only 可信 HTTP evidence、PKCE state CAS、nonce/kid 與 Session/Member/Identity 的 Starry 分區及撤權/D1 安全；**沒有真實官方網路服務或正式 D1 憑證驗證**。
2. AI-2 真程式的離線 Billing committed row 權威、1～4 次缺來源只能 retry/no ACK/no quarantine；第 5+ 次必須持久 DLQ 且匹配回執才准 ACK；不因 Mock 收據產生正式付費權益。
3. AI-3 Queue 6+ attempts 限制 domain 嘗試數、不丟失真正 delivery count；逾期退款/摘要衝突/重播的原子稽核、Quarantine/DLQ/SQL rollback/SQLite :memory: 多寫入與故障測試。
4. AI-4 API/SDK/OpenAPI public surface 仍僅 `GET /v1/health`，Member/Billing/Admin route disabled；P05 `billing.p05.v1-candidate` 為 `PUBLISHABLE=false`。AI-5 尚未獲准，現任 API Owner=AI-4。
5. 原主規格 25 個 seed 和 128 個原始 headings 需 **人工逐項 reconciliation** 才能解鎖 G00；GitHub test check 只檢查格式/來源，不代表產品決策完成。

## 正式 release 判定與禁止操作
- **G00～G10 全部 BLOCKED（11/11）**；`release_authorization.granted=false`；本 Repo Public，不放 secrets/個資/Token。
- 真 Apple/Google 官方 OAuth/PKI/OCSP、Store Sandbox／Google Play 授權、Cloudflare D1/Queues/DLQ/Workers Preview/Staging、EAS/TestFlight/Play Internal/實機、備份回復/最小權限/成本確認未完成正式驗收。
- Cloudflare Worker Builds 曾對前輪 PR 報 Failed；外部 Worker CI/Build 與 GitHub read-only CI 是不同判定，不可宣稱部署成功。此整合不授權調查時觸發遠端部署。
- **不得合併 main、Cloudflare Preview/Staging/Production 部署、操作實際 D1/Queue/Secrets/付款、EAS Build/Update/Workflows 或開通付費服務。** DEV-I EAS Free，GitHub CI 必要但原生雲端建置須另核准。H-Global 工程維持暫停；Starry Battery 永久免費。
- 本整合 PR 的 GitHub CI 即使成功，也只能裁定四組第六輪 **OFFLINE SAME-CHECKOUT PASS**，正式環境／發布仍 **BLOCKED**。

## 後續順序
1. GitHub Actions 在本 Draft 固定 HEAD 實際運行，AI-0 對應 commit / workflow / Job 與 0 failed/skip 留下驗收連結。
2. 若出現衝突或弱化的安全測試，在此隔離分支修復並重跑，不擅自變更其他 Owner 原 PR。
3. G00 需求人工核准、G06 P05 正式契約、Cloudflare Worker Build 失敗調查與真 provider/D1/Store/Device 的隔離驗收，均需明確人工批准範圍及成本；完成證據才可逐步重新審視 Gate。
