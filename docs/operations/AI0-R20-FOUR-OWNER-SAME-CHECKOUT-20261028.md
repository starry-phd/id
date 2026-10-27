# AI-0 R20 四位 Owner 同版離線整合（2026-10-28）

**原始來源全部在 GitHub，人工審閱僅能認定「離線同版相容」而非真 Cloudflare 多 D1 原子提交或 Store 合規。**

## 原始基準
- R19 四 Owner verified Draft [#137](https://github.com/starry-phd/id/pull/137) `b713cbbc44307a325fec71fff74c81defbd95c71`。
- AI-0 F0 App 研究準備 Draft [#140](https://github.com/starry-phd/id/pull/140) `bd57cfc420efc970dc8f152d7a926a19be5dbcf9`：保留此份 App roadmap/UX/研究，仍非產品核准。
- AI-1 Auth [#138](https://github.com/starry-phd/id/pull/138) `aabd113711d4201e2ba5e81aab2f8a68c0d48b34`：3 原始 Blob，Owner 2/2 same-SHA CI success。
- AI-2 Billing [#139](https://github.com/starry-phd/id/pull/139) `2344dbe246a39c375c8394fe43754e99b84ba9d3`：3 原始 Blob，Owner 2/2 same-SHA CI success。
- AI-3 Task/Battery [#142](https://github.com/starry-phd/id/pull/142) `398e447cb650fee533ed8374ffa1e75680d873dd`：4 原始 Blob，Owner 1/1 CI success。
- AI-4 private API/Saga [#141](https://github.com/starry-phd/id/pull/141) `5c051cd4bd1056a599d9e6cd45152b299dd03567`：3 原始 Blob，Owner 1/1 CI success。
- 從 #140 建新 AI-0 branch，**13/13 原始 Owner Git Blob unchanged + 4 AI0-only provenance/schema verifier/Node tests**，Git Tree 一次提交；不合併各 Owner branch，不寫改他們的代碼。

## 這次測試與範圍
- `r20-four-owner-original-sources.v0.json` 保存完整 4 組固定 PR/head/13 原始 Git SHA；`verify-r20-original-sources.mjs` 在 GitHub Actions checkout 重新 SHA-1 驗證 **完整位元檔案內容**，不是只比檔名。
- Node 負測必須阻止偽造 Publisher/身分來源、跨 D1 ACID、Store、Queue ACK、HGlobal 或可買賣免費 Battery；和 R19 所有模組、AI-0 F0 App 決策安全計畫跑**全新同版** CI。
- AI-4 R20 真 R19 Owner adapter 的多個各自獨立 SQLite，明確拒絕沒有官方跨域 signed 身分/HMAC 的成功；不能將其「拒絕」誤當完整正向交易已證實。
- 同一全新版 GitHub Actions 的 Node、Python SQLite、TS/Lint/Expo/Worker **dry-run**與官方 G00–G10 11 blocked 全綠才可稱 `R20_FOUR_OWNER_OFFLINE_SAME_CHECKOUT_VERIFIED`。新 CI 必須以**整合 HEAD**重新核對，不可借四位孤立的綠燈。

## 未通過且不得變更的授權邊界
正式 #87 A/B 跨 D1 架構未決、Q104/Q119 合法處理保存/HMAC/KMS、唯一正式 P05 signed source、不可回退獨立 witness、真 Store/OIDC/EAS、Cloudflare D1/Queue ACK/DLQ /費用/Store listing、首款產品核准均未完成。G00–G10 **11/11 BLOCKED**、`P05/PUBLISHABLE=false`；Battery 永久免費，H-Global 暫停。不得 merge main、部署任何 Preview/Staging/Production、寫真 DB/Secrets/Queues、呼叫 Store/EAS、付款或付費。
