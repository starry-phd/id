# AI-0｜R13 跨五域獨立信任根／金鑰管理／可發布證據前置方案（2026-10-27）

> **文件狀態：PREP / PROPOSED / NO LIVE TRUST AUTHORITY。** 這不是 Key Management Service 已建立、真第三方簽章源已存在、信任根已審核或 Production 可部署的聲明。不得操作真 Secrets、D1、R2、Queues、Store、EAS 或合併 main。
>
> GitHub 固定已驗來源：[R12 AI-0 四 Owner 整合 Draft #94](https://github.com/starry-phd/id/pull/94) HEAD `4a11b387d32aba789c905e03291f3bc18ebd71d6`，已有 3/3 最新同版 GitHub Actions Offline SUCCESS；[跨 D1 ADR #87](https://github.com/starry-phd/id/pull/87)、[PR stack audit #93](https://github.com/starry-phd/id/pull/93) 及 [Issue #1](https://github.com/starry-phd/id/issues/1)。四位 AI-1~4 R13 正獨立實作，不因本文件停工或修改自己的 PR。
>
> 此次 AI-0 只做跨 Owner 門檻與安全檢查；數值、正式環境與廠商存取皆不代替業主決策。

## 1. 權威來源與信任根責任矩陣

| 域 | 專責 | 目前 R12 真正可驗 | 仍然缺少才算具正式權威 |
| --- | --- | --- | --- |
| Auth / 首註去重 | AI-1 | R11 RS256 signed witness + R12 雙鑰 signed independent Head 驗證 | Auth D1 外的**不可回退** Head 與證據簽發者、獨立密鑰 KMS/輪換、身分撤權與 Q119 合法保留 |
| Billing / 退款 | AI-2 | R11 獨立 Billing outbox 逐筆 Gate + R12 RS256 verifier | 官方 Apple/Google Store server 權威、專屬簽章根／輪換、法定保留與真 D1 committed outbox |
| Free Battery | AI-3 | R10 單庫原子候選、R11 Wallet/Hold/Journal 逐筆比對 | **不同於單純 digest** 的真來源簽章/權威、外部見證、跨 Auth/Task 來源一致性、合法贈送 X/Y 核准 |
| Task / AI 成功 | AI-4 | R11 ACK/DLQ contract + R12 RS256 Task proof 驗證 | 真 committed Task issuer、非回退受保護 Head、可信時鐘／key rotation、當下 Member/Session權威 |
| Audit / 合法申訴 | AI-3 | R12 Audit RSA 逐筆簽章＋已寫入事件比對 | 實際 Append-only source、不可回退 Head、管理員 Step-up/法遵保留與復原演練 |

**不可將五個 domain key namespace 視為已有五組真 RSA 金鑰**；JSON 僅預留相互隔離的名稱，而非 Key ID、Secret、KMS 或部署資源。真正信任根和服務隔離需由未來有權限的 Owner 按核准的產品/雲環境配置產生並實測。

## 2. 強制的跨域條件

1. 簽章發行者不可是被復原備份內的資料或客戶端任意輸入。已驗 RSA proof 不是平台自己宣告「真不可回退」的證據。
2. 每域需各自受信任的 issuer/key namespace、證據用途 purpose、Starry brand/env、schema/protocol version、簽章有效期及 key revocation/rotation。不得跨域重用 public verifier 的 acceptance scope，更不能共用 H-Global 授權。
3. 最新序號、簽章 digest 和 monotonic Head 要從**PITR／備份之外的獨立不可回退可信權威**取得，且須保護 key rotation／回滾和時間來源；兩份同時可回退的 D1/R2 備份不能形成「兩份獨立」證明。
4. Auth 刪除/撤權/首次贈送 X、Task 成功／首次合法 Y、Battery 餘額、Billing outbox、Audit event 七域若不同資料庫，仍須額外審查單一權威或 durable Saga；RS256 驗簽**不使跨 D1 寫入有原子性**。
5. Q104/Q119 身份唯一性、合法 consent/erasure、法律 hold、稽核保留和撤權復原不得以一個技術 signer 自動取代法遵核准。
6. 無真實憑證、當前平台權限、受控測試許可與預算證據，不能自填/推測正式環境 key IDs、Store SKU、Battery 數值或第一款 App。

## 3. 本次交付的可執行防錯機制

- [五域機器可讀責任表](./r13-trust-roots.v0.json) 標記 `signing_authority_ready=false`、`independent_nonrollbackable_anchor_ready=false`、各 domain `not_provisioned` 與 `UNKNOWN`，不記錄任何真 Secret、信任公鑰或會員資料。
- [離線驗證器](./verify-r13-trust-roots.mjs) 驗證五域 key namespace 唯一、正確模組與 Owner、沒有偽造真環境授權，且 G00~G10 仍 11/11 BLOCKED。
- [Node 正負向 Gate](../../packages/integration/test/r13-trust-roots.test.mjs) 實際 import R12 五域 TypeScript 模組，斷言所有 live flag/Release OFF；故意偽造共用 key namespace、真 anchor、已核准 KMS、可部署、H-Global 混入、Audit 遺漏、法律保留與 G00 解鎖均拒絕。
- 新測試透過既有 [AI-0 Full Offline Gate](../../.github/workflows/ai0-current-offline-gate.yml) 中的 `packages/integration/test/*.test.mjs` 執行，**不新增 Workflow、定時監控或任何額外付費服務**。

本機離線檢查：
```sh
node docs/operations/verify-r13-trust-roots.mjs
node --experimental-strip-types --test packages/integration/test/r13-trust-roots.test.mjs
```

## 4. 後續真正受控環境與 Release 前置證據

| 權責 | 應有文件／可重現證據 | 目前狀態 |
| --- | --- | --- |
| AI-0 + 有權限業主 | Starry-only 真獨立資源 mapping、隔離測試與核定成本上限 | PENDING |
| AI-1～4 + 安全審查 | 各域金鑰簽發、public key pinned 驗證、key rotation/撤銷事件與完整性事故演練 | NOT PROVISIONED |
| AI-1 + 法遵 | Q104/Q119 consent、被刪會員合法唯一性/去重 witness 保留、PITR 防復活 | LEGAL REVIEW |
| AI-0 + 各域 Owner | 真 D1/Queue/Backup/PITR 合成資料競態、存活性、時鐘漂移、失聯/恢復完整負測 | NOT VERIFIED |
| AI-0 + 業主 | 第一款 App/SKU、免費 Battery X/Y、各任務費率/欠額、官方 Store/EAS 測試與付費核准 | NOT APPROVED |

**R13 四位 Owner 正在自行開發，不因本 AI-0 平行任務變動基準。** 四位正式交接後，AI-0 應以各自最新固定 SHA 和 #94 已驗 base 加本 PR 的安全檢查另開**整合 Draft PR**，重新執行最新同 checkout Gate；**G00~G10 11/11 BLOCKED，`PUBLISHABLE=false`，嚴禁 main merge、Cloudflare 部署、真 DB/Store/EAS/Secrets/付費。** H-Global 工程維持暫停。
