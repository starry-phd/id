# AI-1 R21｜候選 Consumer App Auth／Session／刪帳 UI 狀態契約（離線 Draft）

**派工**：[Issue #1 R21](https://github.com/starry-phd/id/issues/1#issuecomment-6448253032)、[AI-1 Issue #2 R21](https://github.com/starry-phd/id/issues/2#issuecomment-6448277172)。共用上游 [AI-0 R20 四 Owner verified Draft #143](https://github.com/starry-phd/id/pull/143)，固定 `e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb`。R18–R20 already integrated, no repeat. #70 Git Tree SOP and #87 cross-D1 A/B undecided.

## 新增真正可執行的安全功能

`createOfflineCandidateAuthUI`，預設 OFF、只允許 Starry development/staging，只有**候選假資料 UI 預覽**可以消費。輸入限定四張 [AI-0 #136 UX](https://github.com/starry-phd/id/pull/136) 畫面 `SIGN_IN/HOME/ACCOUNT_SETTINGS/DELETE_ACCOUNT` 與 `guest/session/deletion` 輸入形狀。Output 版本 `starry.candidate-ui.auth-state.v0-offline`，只有以下狀態：

| state | UI 使用條件 | 安全含義 |
| --- | --- | --- |
| `guest` | SIGN_IN 訪客展示 | 不讀取 Auth；並不是真 OIDC 登入 |
| `reauth_required` | 受保護畫面無登入、Session revoked/expired/auth_version 失效 | 不允許存取會員權益 |
| `auth_unverified` | 本地 Session readback 目前一致 | **不是已登入**；OIDC/正式 App 尚未核准 |
| `deletion_pending` | 僅 R19/R18/R16 原 Auth 已提交刪帳 + 全 App Session 刪帳時撤銷且目前 legal/retention/lease 有效 | **不是全系統刪帳完成**，沒有 Queue ACK/Billing/Task 全系統 durable receipt |
| `access_blocked` | scope／policy／來源／Session race／資料庫／偽造 claim 不安全 | 只展示阻擋；不外洩來源錯誤細節 |

Auth Session 讀取用現有 `starry_sessions` + `starry_members` SELECT twice（合法 session-purpose 授權、政策版本/可信 server clock 前後檢核）。刪帳模式重用**真正的** R19 `readForOfflineConsumer`（其內部 R18 original committed outbox, Challenge, R16 sealed lease 和 Session deletion-time fence 再驗）。R20 HMAC/身分映射仍不具官方法律授權。所有輸出永不包含 `s_user_id/member_ref/session_ref/OAuth subject/event_id` 或任何 PII，並永久 `authenticated=false,global_deletion_confirmed=false,may_grant=false,may_ack_queue=false,may_publish=false,may_restore=false,live=false`。

## 實作測試與下游 AI-4 API 契約

新 Node `node:sqlite` 負測使用**真 Auth 001/007/011/012/013 SQL**、一次性 challenge 與 R16 test-only lease，加上**分離的 disposable UI :memory: DB**，驗證訪客零資料讀取、正式登入成功不可被虛構、撤權/expiry/Session race、跨品牌/env、政策撤銷、來源 rollback、源已提交仍顯示 pending、沒有 UI DB 變更。`R21CandidateAuthUI` 是供 AI-4 的**純離線、非授權** DTO；AI-4 可透過狀態呈現候選 UX，但禁止建立公開 API/Expo consumer routes 或把局部 `deletion_pending` 升成成功。

## 尚未核准與阻斷

首款 Starry Consumer App 未選定：#136 12 screen 是紙面規格，#140 F0 用途研究未執行。正式 OIDC/Device Auth、#87 physical cross-D1 A/B、Q104/Q119 lawful retention/HMAC/KMS、唯一 signed P05 Publisher、外部不可回退 floor、真 D1/Queue/ACK/DLQ、Store/EAS、成本均缺；**11/11 official G00–G10 BLOCKED，P05/PUBLISHABLE=false**。不 main merge、Preview/Staging/Production、真 D1/R2/Queues/Secrets、正式會員操作、付費與 H-Global 工程；免費 Battery 永遠不能被購買。
