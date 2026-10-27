# AI-0｜R10 四位新程式同版本整合 + AI-0 平行佈局（2026-10-27）

> **本文件為隔離分支的整合候選**，必須等待**本 PR 最新 HEAD** 的全部 GitHub Actions `completed/success`，才能判定 R10 離線整合通過。不得借上游不同 SHA 的綠燈。11/11 Release G00–G10 保持 BLOCKED。

## 固定基礎與來源

- 程式基準：[R9 AI-0 四 Owner 已驗 Draft PR #76](https://github.com/starry-phd/id/pull/76) fixed SHA `e5a3ba76695316b3eaeb218fb0edd901d8820931`。
- 平行規劃納入來源：[AI-0 非競合前置 Draft PR #80](https://github.com/starry-phd/id/pull/80) fixed SHA `cf82d519c29b169e546623bf9353702aa6dd62ef`；兩份 Gate/路線圖文件原狀繼承，並無覆寫四位 Owner。
- 所有檔案取自四位 R10 專屬 PR **最終 SHA 的 Git Blob**：逐檔在來源 Tree 核實，未作原始檔內容變更；合成一次 Git Tree / 一個 Commit。

| Owner | 來源 PR 與固定 SHA | 精確整合 | 交付意義（仍離線） |
| --- | --- | --- | --- |
| AI-1 | [#79](https://github.com/starry-phd/id/pull/79) `e942e04ef80e9aee81278cc2dcf9719d266fb552` | 6 檔 | Auth 的 3 類刪帳／撤銷 Session／首次電池領取 anti-resurrection fences，獨立不可回退 witness 還缺真環境 |
| AI-2 | [#78](https://github.com/starry-phd/id/pull/78) `df69283343c8c1049dc47443c4f64288bc160fc1` | 3 檔 | 真本機 SQLite 的 Q113 reconciliation lease/CAS、退款/重播/重試負測；**非真 Cloudflare D1 或官方 Store** |
| AI-3 | [#81](https://github.com/starry-phd/id/pull/81) `29f1a4b32854975d779ef6efe7323416383cf80f` | 5 檔 | 免費電池單一 D1-shaped batch CAS + hold/journal 回滾；**不是跨 Auth/Task 不同 D1 的原子交易** |
| AI-4 | [#77](https://github.com/starry-phd/id/pull/77) `52cd58a5456699751d2d56a95209057ae14506cf` | 4 檔 | Committed Task/PITR/獨立備份逐筆 digest 與獨立 anchor 的恢復審查；`may_restore=false` |

## 新增 AI-0 驗收檔

- `packages/integration/test/round10-all-owners-gate.test.mjs`：於**同一 Node checkout** 直接 import R10 四位的實際 TypeScript 模組，斷言真跨域相關 Live/Release 全部禁止，以及完整反復活 Fence 的七類名稱與上限；真正行為、CAS/SQLite 故障負測由各 Owner 專責檔案及最新全量 GitHub Offline Gate 驗證。
- `docs/ai/AI0-ROUND10-FOUR-OWNER-OPTIMIZED-GATE-20261027.md`：固定基準、18 個 Owner 檔案的來源、Gate 差異與阻塞。加計 AI-0 兩檔，本次 **20 檔／1 Commit**。
- **原有 #80**：[AI-0 R10 parallel roadmap](../operations/AI0-R10-PARALLEL-ROADMAP-20261027.md) 及 [11 Gate evidence ledger](../release-readiness/AI0-R10-EVIDENCE-AND-DECISIONS-20261027.md) 原狀承接；它們只是治理準備，不是 Release 證據。

## 防止誤判的跨領域 Gate

1. **AI-3 Wallet D1.batch** 的同庫原子性不可替代跨 Auth D1 / Task D1 / Billing D1 的同交易；Q119 首註可合法保留的唯一身份 claim 要與免費 X 發放設計跨庫一致性或經核准的單一 authority，否則保持 disabled。
2. **AI-1 獨立見證** 需真實不可回退、經簽章的域外來源，且要經合法 retention/erasure 和當下 Session/AuthVersion 核驗；同一備份中的 high-watermark 不能防止 PITR 回退。
3. **AI-4 Task digest** 比對只證明同內容，不證明沒有被共同偽造；仍需獨立可信 anchor、真 committed source、法定 hold 和持久 Audit。
4. **AI-2 SQLite** 本機成功不等於 Cloudflare D1/Store 官方授權、真退費、Queue ACK，Paid entitlements 不可啟用。
5. 無正式 OIDC、Apple/Google Store、真 D1/R2/Queues、EAS、受保護 Staging/Production、Battery X/Y/費率、成本/隱私業主核准；Q104/Q119 合規仍要人工 Gate。
6. 維持 `starry-ci.yml` Main Repository policy、正式 Production 手動環境 Gate 與最新 optimized CI；禁止合併 main、Cloudflare Preview/Staging/Production、真 DB/Secrets/Store/付費、EAS Build/Update。H-Global 工程暫停。

## 驗收條件

- 本 PR 最終固定 HEAD 上的最新整合 `AI-0 Current Complete Offline Integration Gate`、專責 Auth/Billing/其它實際觸發的 Actions，全部必須 `completed/success`，且 `docs/release-readiness/check-release-readiness.mjs --assert-blocked` 仍明確通過。
- 過關只允許狀態標籤 `R10_OFFLINE_SAME_CHECKOUT_VERIFIED`，**不是 Release／Staging／Production 或完整 R10 真服務成功**。
