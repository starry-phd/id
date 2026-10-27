# AI-3 R22｜繁星回聲 Legacy Playback/Transcript/AI QA → 新版 Task/Battery 唯讀事件界線

## 來源（只讀已查證）
舊版 Repo [`yukidu/Echo-Starry`](https://github.com/yukidu/Echo-Starry) **固定 main `82cbf4f112af57fcfed12ff2f6cf86010c03560e`**；本輪閱讀以下四份原檔，不變更舊程式：
- `src/utils/offlineAudio.ts` **blob `b1669a4445f2712ec140f40cb5a31c62e17f8ea8`**：瀏覽器 Cache Storage 真存下載完整音檔，`localStorage` 註冊表，3 秒延遲背景下載、15 天未收聽清除，`currentTime/duration>0.95` 標註**本地已播完**；CacheStorage 和本地 `completed` 絕不是 Server Task/Wallet 收據。
- `src/mediaSessionPolicy.ts` **blob `ffcd51b0427f111b1ab379bc462c1a19499e7a07`**：`document.querySelector('audio')`、瀏覽器 `navigator.mediaSession`、`window.dispatchEvent` 的 play/pause/seek/metadata 體驗；需新 Expo Native 的播放器/背景行為設計，不能直接複製 window/DOM。
- `worker/transcriptRouter.ts` **blob `0ccb81865eefe2fcba681d24deaf63911e2e49b6`**：舊 Web Worker 以 `transcript_index`、`transcript_unlocks`、`transcript_corrections`、R2、Workflow/Whisper、舊身分對照與 Starry ID `battery_transactions` 實作轉錄/解鎖/更正；這個 Legacy 寫入流程**不是**新 AI-3 R19/R20 的合法 Wallet writer，不能搬移舊 session cookie 或跨庫副作用。
- `worker/aiSpeakerQaRouter.ts` **blob `bebcf5f4d8bf9a7a2829d2079a209d062385f5cd`**：另有 `qa_claims`、`qa_daily`、模型、級別／每日額度與中央電池查詢、可付費模型；是不同的 QA 作業 domain，**禁止**直接照搬原模型費用表或啟動任何真 AI provider/付費使用。

## R22 真正新增與可執行範圍

全新 `src/r22-echo-playback-transcript-boundary.ts`，只在 Starry dev/staging **預設 OFF**。入口 `createOfflineR22EchoTaskBatteryBoundary({...}).project({event,member_ref?,task_ref?,now_ms?})` 返回明確版本 `starry.echo.task-battery-boundary.v0-offline` 的安全 `R22EchoDTO`。**分離事件域**：
1. `play,pause,seek,progress,ended` 只有 `playback_local_only`、`offline_download` 只有 `offline_cache_unverified`；零 DB/Wallet 存取，不能偽裝 Native 檔案驗證或 Battery 使用權。
2. `transcript_requested,qa_requested` 僅 `job_pending`，零 DB；絕不代表已送付費 AI 或排隊成功。
3. `transcript_job_completed,qa_job_completed` 必須另經合法處理+留存+政策 Gate、實際既有 `AI3_R19_AUTH_SQL` / `AI3_R19_TASK_SQL` / `AI3_R19_WALLET_SQL` 讀回，與新**測試專用** `R22_ECHO_JOB_SQL` 的事件類型/工作 event_ref/source_event_ref/attempt/version/時序一致，再呼叫現有 `R20 Task-Wallet review`。重讀所有 Auth/Task/Wallet/Job 及 R20 Gate；斷線、重播、PITR、會員撤權、source 延到、Task commit／Wallet held 不一致皆拒絕。最多只回 `review_only`、`evidence:'local_only'`，不會回正式 Task settled。
4. Node 14 個事件／負向測試 + Python 18 個使用 **三套獨立 `sqlite3 :memory:`** Auth/Task/Battery DB 的真 rollback/UNIQUE/PITR 測試；Battery 直接使用原本 `0005_free_battery_DRAFT.sql` 的既有 Wallet/Hold/Journal SQL 和約束。Auth/Task 新 Echo 表都是**僅離線測試投影**，不是 AI-1/4 核准 production Schema；**無新 .sql migration**。

## 給 AI-4 Issue #5 的最小化、無個資 DTO

`{schema_version,kind:'offline_echo_boundary_only',event,state,evidence:'none'|'local_only',task_completed:false,wallet_settled:false,balance_verified:false,offline_file_verified:false,can_unlock:false,can_replay_charge:false,may_grant:false,may_settle:false,may_release:false,may_regrant:false,may_restore:false,may_ack_queue:false,may_publish:false,may_sell_battery:false,live:false}`。

*沒有* member_ref、task_ref、raw event_ref、URL、speaker ID、媒體標題、位置／裝置識別、AI prompt/逐字稿、金額、SKU、餘額；不會把畫面 play/ended/download 誤當成 Server 簽章。AI-4 可以在 PRIVATE offline mock 播放器/逐字稿 view-model 消費此 DTO，**不會因此取得執行 Task、直接改 Wallet、解鎖或對外 Queue ACK 的權限**。

## 未核准項與遷移風險

舊瀏覽器 `CacheStorage/localStorage/MediaSession/HTMLAudioElement` 不能等同 Expo Native 的持久檔案、離線權限、背景媒體會話或跨設備同步；Expo Router/Media player/本機儲存方案、DRM/版權/媒體保存、快取遷移與刪除策略需另行確認。**本輪沒有**真播放、CacheStorage 下載、手機檔案、R2、Whisper、AI 問答、Store/OIDC、或正式 Cloudflare Worker 操作。舊費用/身分橋接亦未移植。

#87 Starry 多 D1 A/B 尚未定，P05 真簽章來源/唯一 issuer、Q104/Q119 合法 retention/KMS/HMAC、獨立不可回退 witness、真 D1/Queue/DLQ ACK-after-commit、Echo 正式 MVP/Bundle ID/Store/cost 尚未核准。**G00–G10 11/11 BLOCKED，P05/PUBLISHABLE=false，Battery 永久免費不可賣或換成付費服務。** 全部離線 Draft、不合併 main、不部署、沒有付費、不動 H-Global。
