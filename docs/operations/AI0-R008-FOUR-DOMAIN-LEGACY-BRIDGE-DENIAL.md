# AI-0 Wave1 R008｜跨四個 Domain 的離線拒絕型預驗收（非四 Owner R008 完成）

**本工作只使用 R008 已完成的 AI-2、AI-4 原始交付，以及 R007 繼承的 AI-1、AI-3 原始程式。** AI-1、AI-3 的 **R008** 仍待各自 Owner 的獨立 PR、final SHA、同 SHA CI、Git Blob。這份測試不能被當成「四 Owner R008 合版」或 Live Gate。

## 四個真實模組預檢
- **AI-1 Auth（R007）**：實際呼叫 `createOfflineR007AuthAuthorityReview`。驗證當 R006 proof 不可信，不能讀 private proof、member/session、issuer lease，也不能把客戶端 `verified=true` 當權威。
- **AI-2 Billing（R008）**：實際呼叫 `createOfflineR008CrossProviderConflictGate`。預設 disabled 的 payment claim 不能授權付款、權益或 ACK。本輪完整 Store/RC claim 衝突矩陣仍由 [AI-2 #228](https://github.com/starry-phd/id/pull/228) 的 26 個 Owner tests 及 AI-0 [#230](https://github.com/starry-phd/id/pull/230) 綜合實測。
- **AI-3 Recovery（R007）**：實際從 Python 模組 `OfflineRecoveryMatrix` 對 #87 A/B 尚未決策方案作本機 memory SQLite transaction，再模擬 late member deletion；即使前一筆是本機 review-only 成功，後續 ACK、live 仍為 false。**非**真 D1/Queue、獨立抗 PITR 見證或法務決策。
- **AI-4 Cloudflare Preview（R008）**：實際呼叫 `reviewR008PreviewProposal`，即使 text 形狀正確仍要求另外業主授權，不可部署、綁定資源或啟用自動建置。Cloudflare `id-starry` Preview 與 production auto builds 維持既有 OFF。
- **AI-0 發布**：直接讀取已正式追蹤的 release readiness JSON，呼叫 `preflight`，確定 G00–G10 均 blocked，`release_authorization.granted=false`，四組 synthetic 結果不能改寫發布 Gate。

## 限制與回退
只增加 AI-0 integration test、本文，及 AI-0 專用 mandatory-tests 註冊。沒有修改四組 Owner source、Wrangler、GitHub Actions workflow、main、Cloudflare、D1/Queue/Store/EAS、Ads、實際會員資料或任何付費資源。此測試隨既有 **read-only GitHub CI** 執行。保持 Expo54、Starry Battery 免費、Ads OFF，H-Global 不動。

新 AI-1/3 R008 交付抵達後，仍必須另建「四 Owner 新 R008 SHA」的真正 source-preserving 整合並再驗證同 SHA 完整 CI。回退為關閉這份 AI-0 isolated Draft／捨棄新 test、doc 與 registration 修改，保留 #230 與各 Owner Draft 不變。
