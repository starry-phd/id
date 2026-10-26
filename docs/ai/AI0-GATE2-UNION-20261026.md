# AI-0 Gate 2｜最新四組程式總整合（2026-10-26）

**狀態：Draft union candidate，不是可發布實作。**

## 最新來源固定 SHA
- AI-0 主架構 PR #25 `f9c02e2350fc1cf0311574ac05c3536d9b2900f5`
- AI-0 原始 128 項標題索引 PR #31 `81d0fa997c869d5f74dd1fdc47b69b86d8ecc505`；完整逐項核准仍未完成。
- AI-4 Worker/SDK 合約 PR #34 `4f2091ae31389110190a23b6e2bf91f1120fcce6`（本整合分支基底）。
- AI-1 Starry ID 的安全 store binding PR #33 `f331c89014b6c19854413442a0d3a294017d12e4`。
- AI-2 Billing principal/P05 PR #32 `6aef731edd9648bfeae563af388ece0a837d166f`。
- AI-3 Audit + Billing inbox/outbox PR #28 `bd2df01333a7574be1fb88d24f327028f9dae513`。

## 本次做了什麼
逐檔以各 Owner 最新原始 blob 引進 AI-1、AI-2、AI-3 及 AI-0 原始來源索引。新增 **全組同 checkout** CI：npm 鎖版、總控來源驗證、Worker/SDK 基座+跨 Owner Node 測試、所有擴充後的獨立 domain tests、SQLite-in-memory 故障測試、Expo 與 Wrangler dry-run。

## 驗收界線
- 所有 PR 仍 Draft。沒有修改 `main`、沒有 Cloudflare 或正式 D1／付款金鑰更新。
- CI 只能證明相同 repo 快照的離線軟體驗證，不能替代正式 OIDC/JWKS/PKCE、真實 Store Sandbox verifier、D1 多併發、Queues/Outbox 崩潰復原及 EAS 真實裝置。
- **Auth 多入口責任仍未定型**：AI-1 #33 另外提供 server-issued binding port；AI-2 #32 與 AI-4 #34 各有不同的可信 bridge。AI-0 下一階段須裁決唯一 owner/adapter 路徑、避免不一致與重複安全邏輯。
- AI-2 #32 P05 schema_version `billing.p05.v1-candidate` vs AI-3 #28 canonical adapter `rebuild-p05.0.1-candidate`：只能對版本化的 adapter/映射測試；未核准正式 event 和來源真偽驗證時，不可以發至 Queue。
- AI-3 #28 的 pinned #29 cross-owner integration test 實際鎖定 **舊 AI-2 #29 程式**（且其工作流透過 SHA fetch）；不是對 #32 最新版本的驗收。AI-0 Gate 需另外加入對 #32 的新測試且經隔離通過。
- 主需求 108 + P10 + N10 只有「原始編號盤點」與 25 個新規格 seed，不代表全部採納或完成 Gate0。
- Starry ID/會員 D1 與 H-Global ID/會員 D1 繼續完全獨立；H-Global 不在此 Repo 開發。
