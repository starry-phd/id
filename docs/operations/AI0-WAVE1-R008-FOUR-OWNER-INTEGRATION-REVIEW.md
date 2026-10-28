# AI-0 Wave1 R008｜四 Owner 原始程式同 SHA 合版審閱（離線候選）

## 正式整合來源（不重寫 Owner 原件）
本次整合的 parent 是 [AI-0 R008 2/4+4 Domain 檢查 Draft #233](https://github.com/starry-phd/id/pull/233) `e815561a2d6549da792df59190f7bb727bd5c9ce`。已經繼承：
- [AI-0 Cloudflare Preview OFF 治理 #227](https://github.com/starry-phd/id/pull/227) `aecdee944158b40ffbbd129ddd126136687d7652`。
- [AI-0 2/4 source-preserved 預整合 #230](https://github.com/starry-phd/id/pull/230) `4d14f517ac08e6914159143d60a9cb60a9389ef7`，其中 AI-2 #228 + AI-4 #229 六個原始 Git Blob 已逐字節保留。
- AI-0 自有的 4-Domain legacy R007/R008 denial bridge tests #233，與本輪新的正式 R008 Owner 程式不同，不可混淆。

新加入之原始 Git Blob（不改寫）：
- AI-1 [Draft #231](https://github.com/starry-phd/id/pull/231) HEAD `d668add2153bae35ec89c55786d368718bdf61f6`，3 ADDED-only files：Auth local SQLite memory CAS/Session/Auth version/issuer deny、Node tests、ADR。
- AI-3 [Draft #232](https://github.com/starry-phd/id/pull/232) HEAD `46ea40cba9074c2d8bca76a0916428b974d643f5`，3 ADDED-only files：P05/P06 local outbox/erasure/PITR failure-order、Python tests、ADR。

完整 4 Owner／12 blobs 原始 Git SHA 明細在 `docs/operations/ai0-wave1-r008-four-owner-source.v1.json`，該檔將編入 mandatory 同版測試逐一校驗 SHA-1 Git object bytes。AI-0 只新增整合 manifest、跨組測試、本文，且更新自己 mandatory test registry，不修改任何 Owner R008 新原件或舊版程式。

## 真實新合版負面驗收
- 4 Owners 各 3 Git 原始 blob byte-for-byte；AI-2/4 blob 與先前 #230 預整合完全一致。
- 直接使用 AI-1 R008 `createOfflineR008AuthSessionCasReview`，合格本機 CAS 回應僅 `review_only`，客戶端 `x-verified:true` 不得提升 Auth 權限。
- 直接使用 AI-3 R008 Python `OfflineP05P06FailureOrder` 兩種 #87 未定選項，synthetic local claim 後請求 P06 erasure barrier，驗證 Queue ACK/Live 仍 false。
- AI-2 R008 Store+RevenueCat 及 AI-4 R008 Cloudflare Preview preflight 即使有看似可信的輸入，也不得授權真 Store、權益、Preview 或生產部署；保留全部原 Owner 測試與 #230 的真 double-source review-only 測試。
- 直接使用 `preflight` 讀官方 `release-readiness.v0.json`；G00–G10 **11/11 blocked**、P05/PUBLISHABLE=false、`release_authorization.granted=false`，不能把 offline PASS 當 Live。

## 權限與後續
本合版僅是 **same-SHA offline integrated candidate**。只有本新 SHA GitHub Actions 全部完成成功，才可稱「Gate2 R008 四 Owner 同 SHA 離線通過」；**Gate1 仍 PARTIAL/BLOCKED；Gate3 不得解除**。#87 A/B 沒有決定、Q104/Q119 retention/erasure 沒有法務批准，沒有真 issuer/KMS、獨立 anti-PITR、受保護 Worker、實際 Store 官方驗證或 commit-before-Queue ACK。

Cloudflare Starry `id-starry` 的 Preview/production auto-build 仍維持關閉；**絕不**自行開啟或部署。無 main merge、Preview/Staging/Production、真 D1/Queue/Store/RevenueCat/EAS、AdMob SDK/Ads、Secrets、費用或 H-Global。Starry Battery 永遠免費、Expo54 不變。

**Rollback**：關閉此 AI0 Draft 並捨棄單獨的四 Owner 整合 branch，所有 R008 Owner PRs #231/#228/#232/#229、AI0 partial #230/#233 及 main 均完整保留。
