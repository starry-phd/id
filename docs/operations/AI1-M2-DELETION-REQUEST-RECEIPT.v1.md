# AI-1 M2｜本機刪帳申請受理與雙確認契約 v1.0（未上線）

> 權威來源：[AI-0 #2 工作令](https://github.com/starry-phd/id/issues/2#issuecomment-6517492168)；[AI-3 #288 物理清除 FK 實證](https://github.com/starry-phd/id/pull/288)。本文件定義新 **local-only 申請受理**，不是清除或發佈授權。

## 已實作的最小流程

1. **第一確認**：已驗證本人 Session，向 `POST /v1/starry-id/members/me/deletion-requests` 送出 JSON `{"confirmation":"REQUEST_MY_ACCOUNT_DELETION"}`。成功回 202，持久化 `awaiting_second_confirmation` 並在同一 SQLite statement trigger 記下 `first_confirmation_received`。
2. **第二確認**：以另一個 HTTP POST 請求向 `/v1/starry-id/members/me/deletion-requests/confirm` 送 `{"confirmation":"CONFIRM_MY_ACCOUNT_DELETION","request_id":"<第一步伺服器提供的不透明 ID>"}`。再次驗證**當前** Session、會員、身分連結與時效，交易性 CAS `awaiting_second_confirmation → pending_processing`，trigger 記 `second_confirmation_received`，成功回 202。
3. **查詢本人狀態**：`GET /v1/starry-id/members/me/deletion-requests/status`，同樣要求當前 Starry Session。未曾申請回 404 `NO_REQUEST`；已有申請回 200 與同一不透明 request ID、狀態與確認時間。

所有成功回應只包含 `request_id`、`status`、`first_confirmed_at`、`second_confirmed_at`、`physical_erasure_completed:false`、`execution_authorized:false`。**202 僅代表本機 receipt 已受理**，不是個資已被清理。沒有 `completed` 資料狀態，不能從 API 宣稱清除完成。請 UI 將 `pending_processing` 顯示為「已收到申請，等待依法處理」，而非「帳號已刪除」。

## 授權、冪等與資料最小化

- 可執行 factory 必須伺服器顯式 `enabled:true`；全域 live 預設 OFF。僅 Starry `app_id=starry-id` 且 `development/staging`，不接受 Production、H-Global、Echo。**沒有註冊公開 Worker 路由、OpenAPI 或 SDK**；AI-4 真接線須獨立核准。
- 使用原 R23 Auth 的 **HMAC signed bearer → 當前 Member+Session+Provider subject D1**；同一身分證據再次於 **SQLite INSERT/UPDATE** 中核對 member.status/auth_version、相符 App/environment、未撤銷且未過期 Session、現存 provider subject link。讀取狀態也經該授權查詢，跨會員無法查詢或確認。
- 本人 `(s_user_id,app_id,environment)` 唯一；首次受理產生 CSPRNG 24-byte、不透明 request ID。重試、二十個並行重送、兩次第二確認都重用**同一**申請，不重複產生稽核；不同 Session 若仍屬同一個有效本人可以查詢狀態。第二確認不可在第一確認前完成，也不能用其他 request ID 或單一 POST 混過兩步。
- DB 持久化最少同來源識別 `s_user_id`、不透明 request ID、App/environment、狀態與兩確認時間；稽核表只有 opaque ID、事件類型、scope、時間。**不存 bearer、refresh、Google/Apple ID、PKCE、姓名、Email、裝置指紋或來源權益**。不透明 ID 仍屬可能可連結資料，不能擅自視為完全匿名或設定永久保存。
- 來源受理與 audit 均由同一 SQLite statement 的 `AFTER INSERT/UPDATE` trigger 原子寫入；失敗整個 statement rollback，無「request 已收到但 audit 遺漏」。這是本機 Source receipt，不是 Cloudflare Queue／下游 outbox 成功 ACK。

## 尚未批准與刻意**沒有**做的動作

- 不將 `starry_members.status` 改 `deleted`、不 bump auth_version、不撤銷當前／所有 Session、不移除本人 Identity、不刪名片、不可視為公眾資料已隱藏。**會員在實際清除 Gate 前仍然是 active**；這避免把申請成功誤報成已完成身分撤銷。
- AI-3 [#288](https://github.com/starry-phd/id/pull/288) 已用真 SQLite 證明 **M1/M2 audit FK 阻擋實際物理刪除**。本 DRAFT 004 request 表也以 FK 連 `starry_members`，audit 表 FK 指 request 表，新增的類別與 FK 一樣需要未來逐類法源/期限/存取/合法清除方式審查。不得關閉外鍵、盲目 CASCADE 或用 status `pending_processing` 冒充完成。
- Q104/Q119 法定各類資料保存／實體刪除、個人完整資訊/公開名片清除、所有 Session 一致撤權、獨立 anti-PITR witness、Cloudflare 遠端專用 D1、下游通知與處理者同步、Billing/Store 資料處置、Battery 首註贈資格／anti-重領來源都尚需 AI-0/法遵/各 Owner 的獨立准入。**不以缺少清除法源/遠端憑證阻擋本機合法有效申請收件。**

## 執行證據與回退

- 原始真 SQLite：`test/m2-local-deletion-request.test.mjs`（兩步、20×並行、idempotency、跨會員、session 失效、SQL race、audit 故障回滾、FK 刪除拒絕）。
- 真 Miniflare5／workerd 使用隔離本機 D1：`test/m2-local-deletion-request.workerd.test.mjs`（同 D1 狀態往返、並行、跨會員、Session 撤銷、來源稽核 trigger 故障）。
- 不會在本 PR 遷移任何 D1、不更改 Live Worker 或正式環境。關閉尚未合併的 Draft PR 即可回退**來源**，沒有雲端資料要回滾。
