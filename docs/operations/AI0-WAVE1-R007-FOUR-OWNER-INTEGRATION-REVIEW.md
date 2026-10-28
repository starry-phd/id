# AI-0 Wave1 R007｜四 Owner Source-preserving 同 SHA 整合（離線驗收候選）

- Parent #221 R006 integrated: `5be61848f745cc17de449d773147b8a6a5b5b742`。AI-0 自己的 R007 併發重播修補 parent: `896a816a6c4276654eb5d48f99679ab12c717afa`。
- 4 Owner finalized PRs：[#222](https://github.com/starry-phd/id/pull/222), [#223](https://github.com/starry-phd/id/pull/223), [#225](https://github.com/starry-phd/id/pull/225), [#224](https://github.com/starry-phd/id/pull/224)。各自只新增自己 3 個新檔；全部以 #221 為 parent。**本整合直接引用 12 個原 Git SHA blob，未重寫。**
- 完整 immutable manifest：`docs/operations/ai0-wave1-r007-owner-blobs.v1.json`，包含 exact final owner HEAD、三檔 blob SHA、owner offline Actions 記錄。
- 強制整合負測：`packages/integration/test/ai0-wave1-r007-four-owner-cross-checkout-gate.test.mjs` 7 組（12 SHA、17-field P05、一組 Auth 缺權威拒絕、一組 Store/RC 假付款拒絕、兩種 #87 local SQLite A/B 審閱與 no-ACK、一組實際未註冊 Worker 拒絕、全部 live/Ads/費用/發布 false）。另繼承 AI-0 `ai0-r007-p05-concurrent-replay-failclosed.test.mjs` 四組併發負測。
- R007 合版 **CI status 須依此新 HEAD 在 GitHub Actions 核實**，不得用 #222/223/224/225 individual PASS 代替。所有 Node/Python SQLite 即使通過亦僅 offline synthetic quality gate。
- Gate1 **PARTIAL/BLOCKED**：Q104/Q119 retention/erasure 法務及 #87 cross-D1 A/B 未決，formal issuer KMS、Auth monotonic D1 CAS、independent durable anti-PITR、真正 commit-before-Queue ACK、官方 Apple/Google/RC signed evidence、受保護 Worker 和 Cloudflare approval 尚缺。
- Gate3 **G00–G10 11/11 BLOCKED**；`P05/PUBLISHABLE=false`、`release_authorization.granted=false`；Battery 永遠免費，Q4=A AdMob Mediation 但 **Ads OFF**。Expo54 不升、H-Global 停止；沒有 main merge、Preview/Staging/Production、真 D1/Queue/Store/EAS/AdMob SDK 或新增費用。
- 外部 Cloudflare Workers Builds **與 GitHub offline Actions 完全分列**：上游 #221 [external check](https://github.com/starry-phd/id/runs/122978226227) failed；尚未核對新 R007 外部同 SHA 原始日誌。若新 Draft 自動觸發外部 Cloudflare build，須如實記錄其狀態/費用不確定性，不冒充已部署。
- 回退：關閉新的 AI-0 R007 整合 Draft/丟棄新整合分支，不更動 #221、各 Owner R007 Draft、AI-0 R007 獨立 branch 或 main。
