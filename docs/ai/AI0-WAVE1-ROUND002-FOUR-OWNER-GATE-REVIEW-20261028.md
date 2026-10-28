# AI-0｜Wave1 Round-002 四組合版與 Gate 1～3 審查｜2026-10-28

**本輪狀態：**四位 AI 第二輪成果已在 GitHub 正式提交為個別 Draft PR；此 AI-0 新整合仍只允許離線驗證，**不合併 main、不部署、不付費**。所有檔案使用 Github Immutable Git Blob SHA 直接導入，未手工改寫 Domain Owner 原始檔案。

## 交付來源
| Owner | Draft PR | 固定 SHA | 獨立成果 |
|---|---|---|---|
| AI-1/Auth | [#194](https://github.com/starry-phd/id/pull/194) | `047ad076e2ad2ecd00563a6b3e4770b74904eea8` | 真簽名 Session/SQLite Auth 訊號 → 以獨立 HMAC 將會員建立 App/domain scoped 私有 digest；離線身分審核（9 新測試） |
| AI-2/Billing | [#193](https://github.com/starry-phd/id/pull/193) | `f04f6baddc42b0abcd3710d0381508902bfa987c` | 直接整合 AI-1 R001 簽名 Session 真驗證＋SQLite，多次重新驗證，候選權益仍不發權（13 新測試） |
| AI-3/Security | [#196](https://github.com/starry-phd/id/pull/196) | `963a7eecedb7e764d65f561efb26f6be15a7f093` | P05 簽名來源／身份／durable receipt／法定留存候選 Ports、重讀防 TOCTOU；Queue ACK 與通知發送維持 false（18 新測試） |
| AI-4/OpenAPI | [#195](https://github.com/starry-phd/id/pull/195) | `06de12c7a229e4fd12544442eedd53701ce572a4` | 3 種受保護路由的**未註冊**提案、拒絕授權、P05 Queue 介面草案及 Cloudflare 唯讀修復提案（12 新測試） |

以上為 12 新增的原始 Owner Git blobs；另有 AI-0 Gate 報告、Manifest 及離線檢查。整合基準是 [AI-0 #192](https://github.com/starry-phd/id/pull/192) HEAD `965c5f405c81336109752eb0873a5df90d6f3460`，已含 [Round-001 全 Owner 合版 #191](https://github.com/starry-phd/id/pull/191)。Owner Draft 自己的 GitHub Actions 成功，不代表此 AI-0 新 SHA 已成功。

## Gate 1｜PARTIAL/BLOCKED，離線候選可評估，不可採為正式權威
1. **AI-1→AI-2：真正跨域契約尚未統一。** AI-1 新 R002 `signed_auth_d1_review_only` 以持續穩定非匯出 KMS/HMAC 鍵的 domain-separated JSON payload 產 `member_digest`；AI-2 R002 仍以臨時離線 `offlineDigestKey`、另一份前綴/NUL payload 呼叫 AI-2 R001 `offline_auth_fixture_only` 的本地候選檢查。兩者不能當作正式等價的 identity 轉接、KID/rotation/revocation/member ID 權威。這是兩個**不同的測試方案**，不能直接將 `signed_auth_d1_review_only` 偽裝成原本 `offline_auth_fixture_only` 後放行 Store。Round-003 須 AI-1/#2 與 AI-2/#3 統一版本化 Server-to-Server signed/current Session attestation、AppID/env 範圍、HMAC key/rotations、衝突、合法目的，確保退款/撤權與 Store authoritative state 各自查驗。
2. **AI-3：P05 權威仍是 Ports。** `verifySignedSource` port 讓離線 fixture 回報 `signature_verified:true`，但這不是原生簽章驗證/issuer KID/版本授權。`readEventAuth` 對事件/Actor 的真權威、`readDurableReceipt` 的 D1 CAS/ACK 原子性與 anti-PITR witness、Q104/Q119 法律合法留存仍未接正式 Provider。Round-003 必須先由 AI-0＋AI-4 核准 canonical P05 envelope，再由 AI-1 Auth 提可信 `event_id/actor_ref` SessionFence、AI-3 接持久化 idempotent ACK-after-commit；全部需要另行批准真正資源驗證。不得僅依模擬同一物件重讀宣稱 Queue 可 ACK。
3. **AI-4：受保護路由只是提案，沒註冊。** 真正 Worker `GET /v1/health` 為唯一公開 OpenAPI 路由，`POST /v1/identity/purchase-entry-review`、`POST /v1/billing/entitlement-review`、`POST /v1/notifications/delivery-review` 均標 `PROPOSED_NOT_REGISTERED`、非 2xx、且不可採用 `caller='server_asserted'` 等 UI 欄位作授權。要在 AI-0 收到 AI1/2/3 明確 Domain Owner 後才可開 route，不能在本輪改 Worker / OpenAPI。
4. **外部 Cloudflare：前一版 Worker Build failed**，AI-4 已提供 `npx wrangler preview` 缺 `previews` block 的唯讀 RCA；修復受原 Cloudflare/Repo/成本/Access Gate 管控，未授權改部署設定或 Pipeline。

## Gate 2｜待此整合 HEAD CI 證據，不得沿用四 Owner 舊 SHA
- 需在**同一新整合 SHA** 跑完整 `typecheck/lint`、Node tests (含 AI0 R001/R002、四 Owner R001/R002)、SQLite memory、Expo DEV、Worker dry-run、`release --assert-blocked`。固定四 Owner Git blob SHA 以原件檢查檔證明 byte-for-byte 不改。
- 三個 CI 結果要分開列：**GitHub Offline Actions**、**Cloudflare Workers Builds 外部 Check**、**正式 Store/Cloudflare Live 驗證**。即便所有離線 CI 過，也不代表 External Cloudflare/pass 或 Release Gate。
- 補足的 Gate 1 Cross-Owner contract 在 Round-003 另行提出，不因「同 SHA 合版」而完成。

## Gate 3｜發布仍 11/11 BLOCKED
- `release_authorization.granted=false`、`P05/PUBLISHABLE=false`；未驗證雙端 Store Sandbox、RevenueCat 真 Store SDK／退款恢復、專屬資源 D1/Queue、正式可復原或原生 Build。未核准合併 main、操作 Production/Staging、Cloudflare 真修復、費用、H-Global 或選定 Ads。
- **D01=D** 新消費者 App 於開案使用最新官方穩定 Expo，不改本中央 Expo54；**Q5=B** 新私有 App Monorepo 首款正式開工時才建立；**Ads OFF、Battery 永久免費**。

## Round-003 的最小下一步（GitHub-only）
AI-1 #2 + AI-2 #3：由 AI-1 提出單一 canonical `signed_auth_d1_review_only` 等級／KID/rotation、會話失效與每 App Billing 身分版本，AI-2 使用自己的獨立、真實重新查驗 Server port（不能降級到 fixture），同時保留 Store 官方收據驗證與退款權威 Gate。AI-3 #4：要求 AI-0/AI-4 canonical P05 signer/issuer + AI-1 event_id/actor_ref/revoke SessionFence + lawful retention/持久收據/anti-PITR 的版本化接口與離線測試，**不啟用 Queue ACK**。AI-4 #5：在獲 Gate 批准後才擴充 protected OpenAPI／SDK；Cloudflare 列出隔離驗證與成本／回退的具體書面計畫，**不執行真實環境修改**。AI-0 #1 維護權威 Manifest 與綜合 CI、Release Gate。
