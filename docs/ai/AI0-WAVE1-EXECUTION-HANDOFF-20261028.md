# Starry｜AI-0～AI-4 五組協作開發｜Wave 1 GitHub 交接與驗收清單
> Version: wave1.0 · 2026-10-28 · Owner: AI-0 · Status: **業主核准開始分工與安全分支開發；尚未完成各組實作／合併／部署**。
>
> 本文件位於 AI-0 Draft PR 分支，**尚未合併 main，不代表 main 已採納**；工程現況以實際 Commit／PR／CI／部署證據為準。

## 0. 單一來源與決議順位
- 正式技術包：[Starry 共用技術基座 v1.2 決策整合版（2026-10-28）](https://docs.google.com/document/d/1wHBuIJCA1cMhLcI25MR_EYEdgmpXmzXx_D0UlEWHBAQ/edit?usp=drivesdk)。
- 業主 D-01～D-08 與 Q1～Q5 GitHub 決議：[Issue #156](https://github.com/starry-phd/id/issues/156#issuecomment-6465986591)；新決議取代舊 Issue 正文和 Draft PR 內「D01 owner pending／前置 PoC 必做」之過期部分。
- 既有中央正式工單：[AI-0 #1](https://github.com/starry-phd/id/issues/1)、[AI-1 #2](https://github.com/starry-phd/id/issues/2)、[AI-2 #3](https://github.com/starry-phd/id/issues/3)、[AI-3 #4](https://github.com/starry-phd/id/issues/4)、[AI-4 #5](https://github.com/starry-phd/id/issues/5)。
- 必讀 `AGENTS.md`、`docs/ai/HANDOFF-PROTOCOL.md` 與每人既有上下游 Draft PR、正式 CI／Gate 狀態；不得依 Issue 過期未修正文重新要求業主選已定案題目。
- **開發啟動範圍：現有 `starry-phd/id` 中央 Starry 身分／Billing／免費 Battery／OpenAPI／DevOps，及它們可提供新 App 的共用 Client 契約**；不開發特定其他消費 App，也不接手外部產品。H-Global 全面暫停。
- 新消費型 App 的 **私有 Monorepo 不得現在建立**（Q5=B），首款該類 App 正式開工時再核實建立授權；不要把本中央系統既有 `apps/mobile` 的 Expo 54 當作獲准立即升級。

## 1. 五組本輪交付（可平行的契約與離線測試；避免重疊）
| Owner / GitHub 任務 | 本輪工作與檔案責任 | 可驗收交付 | 依賴／阻塞 |
| --- | --- | --- | --- |
| **AI-0 #1 / #156** | 維護 D01～D08、Q1～Q5 決策登錄；檢核所有 domain writer 與 API/CI Gate；整合差異並審閱 PR | 本交接文件、Issue Dispatch、對應 Draft PR/SHA/CI 狀態、Gate 0/1 逐項裁決 | 無四組證據不得標記「五組已開發完成」 |
| **AI-1 #2** | Starry Auth、Session、會員／權限；設計 `AuthClient` identity/session 安全契約、購買前已登入檢查，僅自己領域資料 | `ai1/*` Draft PR：版本化安全 DTO／mock／拒絕測試（帳號切換、已撤銷 Session、跨 app_id） | AI-4 OpenAPI interface 對齊；不要動 Billing/Battery Writer |
| **AI-2 #3** | RevenueCat＋薄 `BillingClient` 合約，非消耗型買斷、月年自動續訂；跨 iOS／Android 同 App 有效權益；去廣告條件 | `ai2/*` Draft PR：Product/Entitlement mapping、冪等／退款／到期／還原／跨 App 拒絕測試；Store Sandbox 尚未授權實作不可聲稱完成 | AI-1 登入契約；商店政策及真正 Sandbox 是獨立 Gate |
| **AI-3 #4** | Starry 專屬永久免費 BatteryClient、通知／申訴／稽核與復原；不參與內購給幣 | `ai3/*` Draft PR：FREE-only、品牌／app 隔離、安全事件／重試／撤銷／防重放離線測試 | AI-1 身分、AI-4 Queue/事件契約 |
| **AI-4 #5** | 既有中央 Expo/Workers/OpenAPI/SDK/CI；本輪核對真實現有版本、基礎型別測試、失敗 Cloudflare Workers build 原因（唯讀）；廣告三方技術比較 | `ai4/*` Draft PR：真實可重現 typecheck/lint/contract tests、上游 SDK 接口提案與 Cloudflare build 失敗根因／風險；不以 mock 當真 native/Store | D-01=D 適用未來新消費 App，免獨立原生 PoC；現有中央 App 不擅升級；D-04 Ads OFF |

## 2. 已核准的新商業／技術產品規則（狀態：OWNER APPROVED；未實作／未驗收）
- **D-01=D**：新消費型 App 採正式開案時最新穩定 Expo/RN，取消事前獨立 native PoC；真正上架前仍需兩端 Build、原生 SDK 與 Store Sandbox。現有 `starry-phd/id` Expo54 不得擅自升級。
- **D-02=A、Q5=B**：私有多 App Monorepo 架構已選定；首款 Starry 消費 App 正式開案才建立，**現在只維護規格**。
- **D-03=A**：RevenueCat＋thin BillingClient 方向；**僅兩類 Store IAP**：NON_CONSUMABLE 永久買斷、AUTO_RENEWABLE_SUBSCRIPTION 月／年；禁止 consumable、non-renewing。
- **D-04=C、Q4=D**：只研究 AdMob Mediation／AppLovin MAX／Unity LevelPlay，業主最終選商待定；**Ads OFF**，不可私自安裝／啟用真廣告 SDK。
- **D-05=A、D-06=A、D-07=A、D-08=A**：每 App Web 選配且起初關；免費優先與逐筆付費核准；各 App 自有獨立商店商品與權益；StyleSheet＋Tokens＋自有 UI Library（Admin 獨立）。
- **Q1=A**：同 App／同 Starry ID 有效權益跨 iOS／Android 共通，須商店政策與雙端 Sandbox 驗證；商店訂單本身不轉移、不得跨 App 發權。
- **Q2=A**：允許訪客免費瀏覽／試用，**發起商店購買之前一定登入 Starry ID**。
- **Q3=A**：每 App 自行選買斷、月／年訂閱或兩者並行，功能／權益依 App 規格獨立定義。

## 3. 每一回合必填 GitHub HANDOFF（在所屬 Issue/PR 中）
1. `Owner / Issue / 回合序號 / 起訖狀態`：`planning|in progress|draft PR|CI verified|blocked|awaiting gate`。
2. `輸入`：本輪來源文件版號、已核准需求、上游 Issue／PR／SHA。
3. `輸出`：`aiX/*` 分支、Draft PR URL、實際 HEAD commit SHA、變更檔案清單／合約版本。
4. `驗證`：測試指令、同 SHA 對應 GitHub Actions run URL（成功／失敗／略過）、失敗與重現方法。**各家 Cloudflare checks 必須獨立核對**。
5. `依賴`：需其它 AI 的 API／DTO、對方 Issue URL、Gate 阻塞、責任歸屬；不得跨域私改 DB Writer。
6. `風險與下一手`：目前不能做的 Production/Store/native/paid 操作、下一組可直接領取的具體動作。
7. 新回合先讀自己 Issue **最新交接留言**及依賴 PR，**優先復用已有工作，不要複製或覆寫尚未核准的 PR**。

## 4. Release Gate 與已知 CI 問題
- G00～G10 目前仍 **11/11 BLOCKED**，`release_authorization.granted=false`、`P05/PUBLISHABLE=false`。不得自主 merge main、改 Cloudflare Staging/Production、操作真實 D1／Store、開通第三方服務、升級方案或付費。
- 上一輪 D-01 Draft #186 的同一 HEAD 雖有 2 個 GitHub Actions 成功，**Cloudflare `Workers Builds: id-starry` check 仍失敗**；AI-4 需唯讀追因，不可宣稱「全部 CI 都通過」。
- 禁止將非公用設計、真實會員資料、憑證、Secrets、API keys 上傳至本 **Public** repo。
- 五組是**獨立 ChatGPT 對話**，GitHub Issue 留言不會在背景喚醒其它對話；業主仍需開啟對應聊天一次指示讀 #2/#3/#4/#5 才能讓它們各自實際提交。**沒有實際 Draft PR＋SHA＋CI，狀態只能寫「已派工／待接手」，不可稱「四組正在寫程式」。**

## 5. 波次驗收
- W1：四組 Issue 任務與 owners/依賴已派發；GitHub-only 交接格式固定。
- W2：AI-4 提出目前基座契約，AI-1～AI-3 可同步在自身域交付 mock/DTO／安全測試；AI-0 審核 API owner 與權限。
- W3：四個 Draft PR 同版 Commit/CI 與跨模組負面測試，須逐項經 Gate 1／2。
- W4：針對真實 Cloudflare／原生 SDK／商店 Sandbox 待審事項向業主申請**具體權限和成本**；Gate 不因排程加速而取消。
