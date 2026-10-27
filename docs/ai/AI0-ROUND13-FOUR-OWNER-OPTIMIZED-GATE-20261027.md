# AI-0｜R13 四位 Owner 真原始程式同版整合 + 五域信任根前置安全準備（2026-10-27）

> **這是 AI-0 受保護 Draft 的同版離線整合候選。** 必須驗證此 PR 最新 SHA 上全部 GitHub Actions 完成 success，才能標 R13_OFFLINE_SAME_CHECKOUT_VERIFIED；Owner 各自不同版本的 CI 不可替代。G00～G10 正式 11/11 BLOCKED，不合併 main、不部署/不收費，H-Global 工程暫停。

## 精確來源固定 SHA

**Base**：[AI-0 R13 五域安全前置 PR #97](https://github.com/starry-phd/id/pull/97) fixed `0d05aab91ddf12efa6544ebf71a8a15d1cac47fc`，它基於已驗收 [R12 AI-0 四組整合 PR #94](https://github.com/starry-phd/id/pull/94) `4a11b387d32aba789c905e03291f3bc18ebd71d6`。#97 原 4 個 trust-root registry/docs/測試直接保留，無修改 Owner 程式。

| Owner | R13 Draft 與最終 SHA | 直接取自 Source Git Tree 的檔案數 | 真程式交付／仍未達成的真權威 |
| --- | --- | --- | --- |
| AI-1 | [#98](https://github.com/starry-phd/id/pull/98) `68c765961859d7c463fabae61901090f1e4bc71c` | **7** | Starry Auth 的一次性帳號刪除 Step-up CAS、同 DB Session/Outbox/成員刪除 SQL trigger 與 Node/SQLite 負測，**仍未部署真 D1／刪帳服務** |
| AI-2 | [#96](https://github.com/starry-phd/id/pull/96) `e314e883d5e6495f58a85f692012834814e56de7` | **3** | Billing witness+Head 雙 RS256 驗證、防過期/重播/refund rollback；**真 Store、跨 DB 與簽發者未驗** |
| AI-3 | [#99](https://github.com/starry-phd/id/pull/99) `2d1909dc44f6ec88bb27928bb041eec91daf5c2d` | **3** | Audit Q115/Q116 雙簽章 Head、受保護 floor 與審閱中 race/replay 負測；**獨立不可回退 Anchor 未具備** |
| AI-4 | [#95](https://github.com/starry-phd/id/pull/95) `ff35ba9ff97d7c1edac9381aad596141e5a6feaf` | **4** | committed Task signed proof + 第二把 RS256 signed Head 前後檢查競態；**缺真 Task issuer、不能當 live Worker 路由** |

四 Owner **17 個實際檔案**逐一在各最後 PR HEAD Source Git Tree 驗證、直接以原 Git Blob SHA 匯入本次 Git Tree；彼此無相同 path，沒有改寫原始程式。AI-0 新增 **2 個檔案**：`packages/integration/test/round13-all-owners-gate.test.mjs`（直接 import 四 R13 真程式+R12 及 Release flags，確認全部 OFF 和 7 個反復活域）及本固定 SHA 交接。**19 檔／1 Commit**。

## 四 Owner 各別最新 SHA CI（僅說明來源可用，非最終整合驗收）

- AI-1 #98：2/2 latest SHA GitHub Actions completed/success（AI-1 專責 + AI-0 完整離線）。
- AI-2 #96：2/2 latest SHA GitHub Actions completed/success（AI-2 專責 + AI-0 完整離線）。
- AI-3 #99：1/1 latest SHA full offline success；不能聲稱外部 Cloudflare Workers Build 已通過。
- AI-4 #95：1/1 latest SHA full offline success。

## AI-0 最終同版驗收要件
1. 最終 PR HEAD GitHub Actions 的 AI-0 完整 offline Gate、專責 Auth/Billing 全部須 `completed/success`；每個 job step 成功；Node/SQLite:memory:/strict TypeScript/Lint/SSOT 128、11 個 Gate assert-blocked、Expo config、Workers **dry-run**。
2. R13 四個 Owner 新增模組的 `LIVE_*`、`*_RESTORE_ALLOWED`、Task Worker 與 `RELEASE_AUTHORIZED` 旗標仍 OFF；一次性刪帳 SQL 候選的本機 pass 不等於真 Auth D1 Migration 可上線。
3. AI-0 #97 五域信任根 registry 的 `not_provisioned` 繼續表示缺**真正的簽章發行者、非可回退外部 Head、金鑰輪換／授權、時鐘和法遵證據**；RSA Node 暫時金鑰實驗不是 KMS。
4. Q104/Q119、first-gift X／Task Y／免費 Battery Wallet 跨不同 D1 的總體原子性仍待 #87 ADR 審查；Store/P05/Cloudflare D1/Queues/Real OAuth/EAS/成本、首款 App/SKUs 都未正式批准。
5. 上述通過最多只可宣告 `R13_OFFLINE_SAME_CHECKOUT_VERIFIED`。正式 G00～G10 11/11 BLOCKED／`PUBLISHABLE=false`；無法以 Mock/SQLite 和 Dry-run 代替正式發布證據。

**安全**：不得合併 `main`、進入 Cloudflare Preview/Staging/Production、真實 DB/Secrets/Store/IAP/OAuth/EAS 操作或付費；H-Global 保持暫停。下一輪四位 AI 須從本次最終合格整合固定 SHA 接續，透過 Issue #1 與專責 Issue 提交新的 Source PR/SHA/同版 CI，避免重新實作。
