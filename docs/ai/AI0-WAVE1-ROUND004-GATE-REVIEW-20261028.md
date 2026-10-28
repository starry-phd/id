# AI-0｜Wave1 第四輪四 Owner 原件整合及 Gate1–3 判定｜2026-10-28

**狀態：Draft / 僅離線候選整合。** 本 AI-0 PR 以先前完成 [四組 R003 同版整合 Draft #204](https://github.com/starry-phd/id/pull/204) 固定 SHA `f843c82b9f8b6d38a838ffa38d1c629ed28ee7fb` 為基準，保留此前 R001～R003 原碼與 Q4=A / Ads OFF，僅匯入四組 **12 個原始 Git Blob** ＋本輪 AI-0 3 個審查／測試檔。所有正式 Domain Writer、Cloudflare Worker index/OpenAPI、Wrangler、GitHub workflow/main 不動。此報告產生時新 SHA CI 尚未查核，GitHub Actions 真結果另記 Issue #1 和 PR。

## 實際來源（已核對真 PR HEAD、3 個新增檔與 Owner 專屬 CI）
| Owner | 本輪原件 | 做到的事 | 還不能宣稱 |
|---|---|---|---|
| AI-1 Auth | [R004 PR #203](https://github.com/starry-phd/id/pull/203) | Future P05 event/actor+Session version fence、revoked/deleted 狀態 read、offline typed ports 和負面測試 | 真 canonical signer、actor resolver／monotonic D1、Live SessionFence、Queue/Notification |
| AI-2 Billing | [R004 PR #207](https://github.com/starry-phd/id/pull/207) | per-App 非消耗型買斷／月年訂閱 candidate continuity、永不發權、去廣告 candidate 且 Ads OFF | 真 Apple/Google 收據、RevenueCat webhook、退款與持久/跨端權益、Live |
| AI-3 Security/Battery | [R004 PR #206](https://github.com/starry-phd/id/pull/206) | P05 signed actor→合法保留→claim CAS→外部 witness→commit-before-ACK 格式化合約，所有狀態 deny/只可 review | 真 cryptographic issuer、實體 CAS/D1、anti-PITR 證據或真 Queue ACK |
| AI-4 API/Expo/Ads | [R004 PR #205](https://github.com/starry-phd/id/pull/205) | Q4=A Google AdMob Mediation future-only Adapter／Ads OFF deny gates、無 SDK、無 Ad Unit | 真 AdMob SDK/帳戶/投放、公開 protected Worker routes、Cloudflare preview 修復 |

## Gate1｜PARTIAL/BLOCKED
1. **真正簽章事件的唯一發行者未建立。** AI-1 R004 `verifyCanonicalSource` 仍是注入的未正式核准 port，AI-3 R004 故意只接受 `signature_state:'unverified_candidate'` 的模擬描述，沒有可信 KMS、actor binding 與持久單調 `session_version`。只靠結構相符或 JSON 同一物件，不可能授權發通知或 ACK。
2. **AI-1/Billing 真實合約仍只到離線拒絕。** AI-2 R004 倚賴 R003 `IdentityAuthorityPort`，但其來源仍為無 Live / Store authority 的簽名 Session + SQLite review-only。正式 Store/RevenueCat signed receipts/webhook/退款持久化與跨 iOS／Android entitlement 授權、Key custody/rotation、合法用途待後續 Gate。
3. **AI-3 durable & cross-D1**：P05 lawful Q104/Q119、持久 CAS、外部 independent anti-PITR witness、#87 資料庫策略及 ACK-after-commit 原子性並未完成，也沒有現在就新增真 D1/Queue 的業主授權。
4. **AI-4** 真 Worker/OpenAPI 仍只 `GET /v1/health`；受保護 POST 路由仍未註冊、error-only 提案不可充當 200 成功結果。外部 Cloudflare Workers Builds 歷史失敗需隔離修復方案和獨立核准。
5. **Ads Q4=A** 已選 Google AdMob Mediation，`adsEnabled=false`、`adsSdkInitialized=false`、`adRequestsEnabled=false`；AdMob 官方後台的廣告排除政策由業主未來自行設定，不需要在中央 UI 重複造另一套不可保證同步的封鎖服務。不得因選商開 Ads。

## Gate2｜新整合同一 SHA 驗證
必須執行 R001～R004 四 Owner Node+SQLite :memory:、root TS/lint、Expo DEV Config、Worker dry-run、release `--assert-blocked`，外加 AI0 R004 原 Git Blob SHA / 版本契約 / Q4=A / 真實 deny-only 跨組 Gate 的 6 組新測試。**每個 GitHub Actions workflow 與 Cloudflare 外部 Worker Build 需分開記錄**，不能以四個 Owner branch 自己通過代替這個 SHA。

## Gate3｜BLOCKED
正式 Release G00–G10 **11／11 BLOCKED**，P05/PUBLISHABLE=false；主分支/Production/Store/RevenueCat/EAS/Cloudflare/D1/Queue/廣告/真用戶資料及任何費用，**一律沒有本輪執行授權**。Starry Battery 永久免費，H-Global 不在任務內，中央 Expo54 不升級，Q5=B 新私有消費 App Monorepo 等第一款實際開案才建。

## 下一步
AI-0 建議將第四輪合版的唯一版本化接口列入第五輪交接：AI-1 actor/current Session monotonic port → AI-3 P05 lawful/claim/witness → AI-4 future transport（全程 deny-only），AI-2 負責真 Store Sandbox 驗收設計（授權前絕不呼叫），AI-4 維護 AdMob Q4=A 規格與 Cloudflare RCA。若涉及 Q104/Q119 或 #87 的實質法律／業務政策，須呈業主裁決，不能由 AI 臆測。任何需要雲端、憑證、商店或付費的動作都先另案核准。
