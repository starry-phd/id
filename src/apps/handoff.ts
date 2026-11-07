import { catalogHandoffLines, type CatalogProduct } from './catalog';
import type { AppEntry } from './registry';

const GUIDE_URL = 'https://raw.githubusercontent.com/starry-phd/id/main/docs/integration-guide.md';

/**
 * Version of the handoff text. Bump both whenever the text below changes (a unit test fails until you do),
 * so the Owner can tell at a glance whether the copy an App's AI received is the latest one.
 */
export const HANDOFF_VERSION = '2026-11-07.7';
export const HANDOFF_UPDATED = '2026-11-07 17:30（台灣時間）';

function list(values: readonly string[]): string {
  return values.length === 0 ? '（無）' : values.join('、');
}

/**
 * The instruction the Owner pastes to the AI that builds a new App. It carries only values that are
 * already public (nothing secret) and tells that AI how to connect to Starry ID, GitHub and Cloudflare
 * without touching Starry ID's code or asking for new Apple/Google console work.
 */
export function buildHandoff(app: AppEntry, origin: string, options: { battery: boolean; products?: readonly CatalogProduct[] } = { battery: false }): string {
  const id = app.app_id;
  const lines = [
    `【串接指令版本 ${HANDOFF_VERSION}｜更新時間 ${HANDOFF_UPDATED}】`,
    `你是繁星生態系 App「${app.name}」的開發者 AI。Starry ID（繁星中央會員系統）已經替這款 App 登記完成，請照下面的資料串接。不需要、也不可以修改 Starry ID 的程式碼或設定。`,
    '如果這款 App 已經串接過：不要重做。請直接跳到「六、已串接 App 的更新檢查清單」，逐項檢查現有程式，只補上缺少或過時的部分，開 PR 後回報差異。',
    '',
    '## 一、已登記的資料（都不是秘密）',
    `- app_id：${id}`,
    `- 名稱：${app.name}`,
    `- iOS Bundle ID：${app.ios_bundle_id ?? '（無）'}`,
    `- Android package：${app.android_package ?? '（無）'}`,
    `- Apple Team ID（Passkey 用，由業主在 Admin Lite 填寫）：${app.ios_team_id ?? '（業主尚未填寫）'}`,
    `- Android 簽章憑證 SHA-256 指紋（Passkey 用，由業主在 Admin Lite 填寫）：${app.android_cert_sha256.length > 0 ? `已填 ${app.android_cert_sha256.length} 組` : '（業主尚未填寫）'}`,
    `- 網頁版來源（CORS 與登入回傳網址）：${list(app.web_origins)}`,
    `- App 深層連結回傳網址：${list(app.return_urls)}`,
    `- 最低版本：${app.min_version}`,
    `- Starry ID 網址：${origin}`,
    `- 驗證登記是否生效：GET ${origin}/v1/apps/${id}/config（應回傳 status 為 active）`,
    '',
    '## 二、先讀這兩份文件',
    `- 串接說明：${GUIDE_URL}（登入第 2 節、網頁版與 Android 登入中繼第 11.2 與 11.3 節、API 與換發第 3 節、帳號功能第 4 節）`,
    `- API 契約（OpenAPI 3.1）：https://raw.githubusercontent.com/starry-phd/id/main/openapi/starry-id.v1.json（請用它產生型別，不要手寫）`,
    '',
    '## 三、要完成的事',
    `1. GitHub：在 starry-phd 組織建立 Repo「${id}」（已存在就沿用）。main 分支用 PR 合併、CI 全綠才可合併；不提交任何 token、金鑰、.env、Cloudflare 帳戶 ID。`,
    `2. Cloudflare：需要後端時，Worker 名稱用「${id}-api」，先部署 staging 再 production。Secrets 只放 Workers Secrets、GitHub Actions Secrets 或 EAS Secrets。`,
    '3. 登入：只用 Starry ID，不要自己建立會員系統。iOS、Android、網頁三個平台一律使用 Starry 登入中繼（瀏覽器登入），不要使用原生 Apple／Google 登入 SDK，這樣完全不必到 Apple 或 Google 後台為這款 App 做任何設定。',
    '   - 流程照串接說明第 2、3 節與 11.2、11.3 節：先 POST /v1/auth/nonce 取得 nonce，再導向中繼網址，登入後帶著 id_token 回到登記過的回傳網址，最後 POST /v1/auth/{apple|google} 換取 Starry 的 Token。',
    `   - 中繼網址：${origin}/auth/{apple|google}/start?app_id=${id}&nonce=<nonce 的 SHA-256 十六進位小寫>&return=<上面登記過的回傳網址>&state=<隨機字串>`,
    '   - iOS 與 Android：用 expo-web-browser 的 openAuthSessionAsync 開啟中繼網址，回傳網址用上面登記的深層連結；App 的 app.json 要宣告對應的 scheme。',
    '   - 網頁版：整頁導向中繼網址，回傳網址用網頁版來源底下的網址。',
    '   - 回傳網址必須是上面登記的深層連結，或網頁來源底下的網址；沒登記過的網址會被拒絕。',
    '   - Passkey（必做）：登入頁除了 Apple、Google，一定要再提供「使用 Passkey 登入」按鈕，iOS、Android（App Store、Google Play 的手機版）與網頁版都要有。Passkey 屬於 Starry ID：relying party ID 就是 Starry ID 網址的主機名稱（id.starry.phd），所以會員在任何一款 App 或帳號中心建立的 Passkey，在所有 App 都能用。',
    `   - 登入：POST ${origin}/v1/auth/passkey/options {"app_id":"${id}"} 取得 publicKey（含 challenge、rpId），交給系統的 Passkey 功能簽署，再 POST ${origin}/v1/auth/passkey，body 為 {app_id, id, clientDataJSON, authenticatorData, signature, device_label}，回應與 Apple／Google 登入相同（Token、user、consent_required）。options 的 challenge 單次有效、綁定這款 App。`,
    '   - iOS 與 Android 用同一個套件（建議 react-native-passkey，需要 Expo development build，不能用 Expo Go）：Passkey.get / Passkey.create 的 rpId 一律用 options 回傳的 rpId（id.starry.phd），不是這款 App 自己的網域。iOS 要在 app.json 的 ios.associatedDomains 加上 webcredentials:id.starry.phd。Android 不必改程式設定。',
    '   - 網頁版：用 navigator.credentials.get / create，publicKey 直接用 options 回傳的內容（challenge 要從 base64url 轉成 ArrayBuffer，rpId 保持 id.starry.phd）；網頁來源已登記在 Starry ID 的 /.well-known/webauthn（相關來源），瀏覽器支援時可直接使用；先判斷 window.PublicKeyCredential 存在才顯示按鈕，不支援時只顯示 Apple／Google。',
    `   - 業主要在 Admin Lite 的「編輯登記資料」填入 Apple Team ID 與 Android 簽章憑證 SHA-256 指紋（上架後從 Play Console 的「應用程式簽署」複製），Starry ID 會自動產生 Apple 與 Google 要求的網域驗證檔（${origin}/.well-known/apple-app-site-association、${origin}/.well-known/assetlinks.json）；沒填之前 iOS／Android 的 Passkey 不會成功，網頁版不受影響。請把這件事列入回報給業主的清單。`,
    `   - 新增 Passkey（設定頁放「新增 Passkey」「我的 Passkey」）：POST ${origin}/v1/me/passkeys/options（帶 Access Token；需要 10 分鐘內登入過，否則回 403 REAUTH_REQUIRED，請會員重新登入）→ Passkey.create → POST ${origin}/v1/me/passkeys {clientDataJSON, attestationObject, name}。列出 GET /v1/me/passkeys，移除 DELETE /v1/me/passkeys/{id}。每位會員最多 10 把；Passkey 只是額外的登入方式，不能取代 Apple／Google，也不會建立新會員。`,
    '   - 錯誤處理：使用者取消不要顯示錯誤；InvalidStateError（這支裝置已有這把 Passkey）請白話說明；找不到 Passkey 時引導改用 Apple 或 Google 登入。',
    '4. 會員身分只用 Starry 的 user_id（內部以 provider＋sub 辨識，不用 Email 或姓名合併）。App 後端用 GET /.well-known/jwks.json 驗證 Access Token。',
    '5. App 內必須提供串接說明第 4 節的帳號功能（登出、刪除帳號、同意條款等）。',
    `   - 客服入口：設定頁放「聯絡客服」，用系統瀏覽器開啟 ${origin}/support?app_id=${id}&app_version=<App 版本，例如 1.4.2 (88)>&device=<裝置型號，例如 iPhone 15 Pro>（值要先做網址編碼）。會員已登入網頁帳號中心時，客服單會自動帶上會員編號；版本與裝置只放這兩項，不要放其他個資或 Token。`,
    '6. 需要販售（RevenueCat）時，才依串接說明第 5 節處理；需要業主設定的項目，請列成清單回報給業主。商店商品與權益名稱以業主登記的「商品目錄」為準，不要自己新增或改名：',
    ...catalogHandoffLines(options.products ?? []).map((line) => `   ${line}`),
    ...(options.battery
      ? [
          `7. Starry Battery（會員共用的免費 AI 用量月額度）已為這款 App 開通：任務代碼一律以「${id}.」開頭（例如「${id}.ai」），自行命名即可，不需向 Starry ID 登記。`,
          '   - 每個任務消耗幾顆由這款 App 自己決定（在 App 自己的設定頁設定，只有超級管理員可改；App 後端必須在伺服器端再確認呼叫者是 Owner，可用 GET /v1/me 的 staff_role）。預留時直接送 units（顆數，1–100）與 task_label（顯示給會員看的任務名稱）。',
          '   - 服務金鑰由業主另外提供，只放在 App 後端的 Secret（名稱用 STARRY_BATTERY_KEY），不可放進 App、不可提交到 Git、不可寫進日誌。',
          '   - 在這款 App 的每個 Repo 的 CI 加入 gitleaks 掃描，並沿用 Starry ID 的規則檔（https://raw.githubusercontent.com/starry-phd/id/main/.gitleaks.toml，含 sbk_ 金鑰格式），讓金鑰一旦出現在提交內容就擋下合併。',
          '   - 只有 App 後端能預留與扣除 Battery：依串接說明第 9 節，預留 → 執行 AI 任務 → 成功確認扣除、失敗釋放；Starry ID 無法連線時不要開始 AI 任務。',
        ]
      : ['7. Starry Battery 尚未為這款 App 開通；需要 AI 用量時，請業主在 Admin Lite 的 App 頁按「開通 Battery」，再依串接說明第 9 節串接。']),
    '',
    '## 四、規則',
    '- 不要改 Starry ID 的 config/apps.json，也不要直接寫 Starry ID 的資料庫。這款 App 已由業主在 Admin Lite 登記。',
    '- 不要在 App 內放服務金鑰；服務金鑰只能放在 App 後端。',
    '- 不用向 Apple 或 Google 後台登記網頁版網域：網頁版與 Android 都走 Starry 登入中繼，Apple 與 Google 只在 id.starry.phd 設定過一次。',
    '- 如果你認為這款 App 需要原生登入（體驗考量），先回報業主，不要自行改用；原生登入需要業主另外到 Apple、Google 後台設定。',
    '- 下列事項必須先取得業主核准：付費方案或可能產生額外費用的操作、App Store／Google Play 送審與正式發布、刪除或還原正式資料、刪除既有的 GitHub 或 Cloudflare 資源、建立新的雲端或商店帳號。',
    '- 需要業主親自登入 Apple、Google、Cloudflare 或商店後台時，停下來，把「要填什麼值、填在哪個頁面」寫清楚回報，不要索取密碼。',
    '',
    '## 五、完成後回報',
    `- 你依據的串接指令版本（${HANDOFF_VERSION} 以後才是最新；版本較舊請回報業主重新取得）。`,
    '- 已建立的 Repo 與 Worker 名稱、每個 PR 與 CI 結果。',
    `- 用 GET ${origin}/v1/apps/${id}/config 驗證的結果。`,
    '- 還需要業主處理的事項清單（只列確實需要業主的）。',
    '',
    '## 六、已串接 App 的更新檢查清單（2026-11-07）',
    `以串接說明第 12 節為準（${GUIDE_URL}）。逐項檢查，已符合的略過，只補缺少或過時的：`,
    '1. Battery 預留的錯誤處理：409 BATTERY_APP_CAP（這款 App 本月用量達上限）與 503 SERVICE_UNAVAILABLE（維護模式）都不得開始 AI 任務，並提示會員稍後再試。',
    '2. 量子電池：GET /v1/me/battery 有 quantum 欄位；預留回應有 quantum_amount、quantum_charged；先扣免費月額度、不足才扣這款 App 的量子電池。要販售時商品與顆數由業主在後台設定，購買走 RevenueCat 一次性商品。',
    '3. 改用單檔 SDK：https://raw.githubusercontent.com/starry-phd/id/main/sdk/starry-sdk.ts（取代自己寫的 Battery 與會員呼叫）。',
    `4. 啟動時（以及每次回到前景）讀取 GET ${origin}/v1/apps/${id}/config：依 status 顯示維護或停用，低於 min_version 要求更新；其中的設定鍵值是公開內容，不放機密。status 變成 paused 有兩種原因：業主手動維護，或用量暴增保護自動暫停（這款 App 每小時 Battery 預留次數超過業主設定的上限），兩者處理方式相同：顯示維護畫面、不要自行重試轟炸，恢復由業主決定。`,
    '   - config 回應的 notices 是業主發布的公告（可指定這款 App 與時段，starts_at／ends_at 為毫秒時間戳）：有內容時在 App 內顯示（橫幅或可關閉的對話框），沒有就不顯示；公告文字只當純文字顯示，不要當 HTML 解析。',
    '5. 驗證 Token：快取 JWKS，遇到不認得的 kid 就重新抓取（金鑰輪替期間新舊並存）。',
    '6. 刪除帳號：立即永久刪除、沒有撤回期、不會自動取消商店訂閱；App 內說明文字要一致。',
    '7. 條款與隱私權政策有新版本：consent_required 為 true 時顯示同意流程。',
    '8. Passkey：登入頁（iOS、Android、網頁）要有「使用 Passkey 登入」，設定頁要能新增、列出、移除 Passkey，做法見「三、3」。其餘不需要實作：邀請碼（會員在 https://id.starry.phd/account 兌換，取得這款 App 的免費量子電池）、公告與維護的設定（業主在後台操作；App 只要照第 4 項顯示）、資料匯出、通知類別開關（會員在帳號中心設定）。',
    `9. 客服入口：設定頁要有「聯絡客服」按鈕，開啟 ${origin}/support?app_id=${id}&app_version=…&device=…（做法見「三、5」）。`,
    `10. 後端跑在同一個 Cloudflare 帳號的 Worker 時，可以選用 Service Binding 內部直連 Starry ID（做法見串接說明第 14 節）：網址與標頭都不變，一定要帶 x-starry-app-key；這是選用的，不用也符合規範，改了要自行測試。`,
    '11. 檢查完回報：每一項是「已符合」或「已補上（PR 連結）」，以及需要業主處理的事項。',
  ];
  return lines.filter((line, i) => !(line === '' && lines[i - 1] === '')).join('\n');
}
