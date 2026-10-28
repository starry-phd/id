# ADR D-06｜業主正式決議 A：免費額度優先、所有新增付費及超額升級逐筆核准（2026-10-28）

> **權威狀態：OWNER_APPROVED_COST_CONTROL_POLICY / MONTHLY_BUDGET_UNDECIDED / NO_NEW_SPEND_AUTHORIZED。**
>
> 業主原話：「**D-06 我正式選擇 A。請記錄 GitHub，保留所有新增付費及超額升級需個別取得我批准的規則，具體每月預算金額另議。接著繼續 D-07。**」

## 1. 正式選 A，不可誤作 B 或 C

- 這是**費用管理與人工授權規則**，而非採購、訂閱、預算數字或平台技術選型。**首選免費層／現有已核准且在付費中的方案**；優先以有效額度、合理的 CI 節流與逐 App affected builds 減少成本。
- **每一筆新增費用、付費方案啟用、方案升級、超額購買/計畫加購、用量上限提高及新增會產生計量費的資源，皆須先取得業主針對當次操作的明確批准**。包括金額、幣別、一次性或每月、可能的超額、付費帳號、環境、使用期限、停止/回退與責任者。
- **沒有批准的最高月費、沒有「預設允許 US$X」的自由支出權**。月度總預算金額明確為 `UNDECIDED`，先不代替業主填入 US$5、US$19、NT$1,500 或任何試算值。
- **先前已支付/已合法訂閱的服務不因 D-06 被擅自取消、退款、升級、關閉、變更授權或自動續費設定。** 現有 Cloudflare Workers Paid US$5/月為過去已知狀態但尚須在實際帳戶核對；本次不是對其再次購買或承諾永久支付。Apple 開發者、Google Play、GitHub、Expo EAS、RevenueCat、網域及其他帳單也要按**實際帳戶**核實，而不是把他人舊對話的價格當成正式契約。
- **費率和硬上限分離**：預算預警 ≠ 自動停止計費。每個 provider 須標明是否具有真正支出上限、用量 quota、告警通知及超額的後果；當無可靠硬停止，必須採安全節流／拒絕啟動可計費新工作、人工逐筆批准及定期核帳，不得宣稱 100% 不會有被動計量費。若需要真正防超支，應先選擇「不啟用可超額計費功能」或合約可硬控的方式，必要時讓業主評估取捨（服務中斷風險）。
- **10 款 App 預期短期上線、30–50 長期容量規劃不是支出核准**。共用一份平台方案可能可節省費用，但不能假設新 10 App 的所有 GitHub/Cloudflare/EAS/RevenueCat/Google/Apple 額度都互通或沒有新費用；按 provider/帳號/地區/計費 SKU 實際驗證。

## 2. 各平台的 D-06 逐筆批准 Gate

| 成本來源 | 首先檢查與使用的選項 | **需要另行業主批准的操作** |
|---|---|---|
| **GitHub 私有 Monorepo / Actions / Packages** | 無新增付費帳號優先；核對免費 Repo、Actions 可用分鐘、儲存和包散布限制，CI 只驗受影響 App | 新 Private Repo 本身的建立另有 D-02 授權門檻；購買 Team/席次、加購 Actions 分鐘/runner/storage、開啟付費超額與增加限額 |
| **Expo EAS** | 官方當期 Free／現有額度、降低 Native Build 次數、必要時只 build 受影響 App | 由 Free→Starter/Production、EAS 新付費專案／超額建置／更新量計費、增加信用額度或任何按量費 |
| **Cloudflare Workers / D1 / Queue / R2 / Logs / AI 等** | 使用已核准的現有帳號與額度（仍須隔離正式資料）；唯一帳號實際計費層／用量需讀帳單證據 | 新增付費 Worker/服務、超額計費、額度升級、提高用量限額、建立會計費的 Staging 資源；**此前同意的 Staging 只是方向，不是已核准具體資源與費用** |
| **RevenueCat（D-03 已選 A）** | 評估當期免費門檻、追蹤營收計算方式及可能隨營收自動產生的費用；不承諾永遠免費 | 帳號／Project/商店連接、任何付費方案、進入自動計費門檻前的商業上線與收費正式批准；須揭露商店佣金、稅金/退款與交易／結算規則 |
| **Apple／Google Store** | 既有開發者帳號及已付費狀態讀取、當期上架／交易佣金規則 | 新開帳號、續約／付款方式異動、上架與商業收款須依 Store Gate 個別批准；商店抽成／VAT／交易佣金可能隨銷售自動發生，不能假稱本政策會使費用停止 |
| **D-04 未決 Ads、AI API、簡訊/郵件、監控、網域等** | 可用免費方案、先檢查合法性與限額，保持 Ads 默认 OFF；AI 功能先不額外購買 | 新合約、可計費 API key/流量、監控高容量、行銷支出、付費網域、資料保留升級和額外服務 |
| **Staging** | 先做唯讀盤點、成本/安全/刪除設計與合成測試；不使用既有正式 D1/Worker | 每個新 Worker/D1/Queue/Access/配置／部署與潛在計量超額、清理/回退和執行範圍均須另行批准 |

**不必要的大額額度不可先買再補批准。** 供應商若有用量自動計費，就應在使用前說明可能的費用，不可只等超額後才告知。

## 3. 每次涉及額外費用，AI 需向業主提供的最小核准卡

1. **目的**：為哪個 App／中央服務／Staging 做哪一件操作？不做會卡住哪個 Gate？
2. **帳號與服務**：實際 Provider、帳戶、方案、使用環境（Dev/Staging/Prod），是否由其它 App 共用。
3. **預估費用與不確定性**：當期官方定價來源與時間、一次性／訂閱／按量、最低／估計／可能超額、幣別及稅金；**未知就明寫 UNKNOWN**。
4. **防超額措施**：是否有真正 hard spending cap，僅支出告警或配額警示，能否在執行前停用按量計費，誰接收通知。
5. **可回復性**：試驗截止時點、撤銷金鑰、停止任務、刪除隔離資源、取消付費及資料保留/刪除。
6. **業主回覆**：同意的**具體操作、費用上限/條件與時間範圍**記在 GitHub（只寫去識別決議，不寫票證、付款資訊、帳號私密資料）；未回覆或不明確 = `PENDING`，不得執行。

對「既有帳號可能發生的自然續費／既有用量」應另設**讀取式帳單巡查**與風險告知，不能聲稱未授權就絕對不會扣款；AI 不能自行取消原有服務。

## 4. 不受 D-06 變更的既有核准與專責

- [D-02＝A](./AI0-D02-OWNER-APPROVED-PRIVATE-APP-MONOREPO-20261028.md)：一個未來新私有多 App Monorepo，**Repo 尚未建立**；既有 Public `starry-phd/id` 中央 Auth/Billing/免費 Battery 的唯一 Writer/Service 保持獨立。
- [D-03＝A](./AI0-D03-OWNER-APPROVED-REVENUECAT-BILLINGCLIENT-20261028.md)：RevenueCat＋自有薄 BillingClient 是**架構選型**，非付費/Store/Sandbox/真收費授權。
- [D-04＝C](./AI0-D04-OWNER-APPROVED-ADS-COMPARISON-20261028.md)：僅比較 AdMob MAX/LevelPlay 等供應商，Ads 保持 OFF，正式服務商**尚未決定**。
- [D-05＝A](./AI0-D05-OWNER-APPROVED-OPTIONAL-APP-WEB-ADMIN-SEPARATE-20261028.md)：每 App Web 選配、Starry 第二波中央管理中心維持獨立 React/Vite/TanStack 技術，**不提早實作第二波 UI**。
- AI-0（總管）負責成本／授權的 GitHub 可追溯紀錄；AI-4（DEV-I）負責 EAS/GitHub/Cloudflare/App Factory 的**事前成本／執行證據**；AI-2 負責 RevenueCat/Store 交易費的事前拆解，AI-1/AI-3 按各自原有中央 Auth/永久免費 Battery 邊界，不自動購買任何服務。**H-Global 不參與本輪實作**。
- **D-07 跨 App 訂閱/解鎖/去廣告權益仍 `UNDECIDED`**，D-08 UI、D-01 真原生方案和正式中央 G00–G10 都沒有因選 A 解封。

## 5. 這次真的做了／沒有做的事

**有：** 僅於既有 GitHub 受控 Draft 分支提交本 ADR、機讀決議與離線反越權測試；向 AI-0／AI-2／AI-4 Issue 交接，CI 依新 SHA 獨立驗證。

**沒有：** 使用／取消／改動任何帳單；沒有建立或升級服務、購買 EAS、Cloudflare 資源、Store／RevenueCat 訂閱、廣告、改 GitHub main/權限、部署任何 Worker/Native/Production 或觸及 H-Global。正式 Release G00～G10 11/11 BLOCKED、P05/PUBLISHABLE=false。

**本 ADR 僅確認 D-06 A 與人工逐筆批准規則；每月預算金額另議。**
