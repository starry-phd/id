import { catalogHandoffLines, type CatalogProduct } from './catalog';
import type { AppEntry } from './registry';

const GUIDE_URL = 'https://raw.githubusercontent.com/starry-phd/id/main/docs/integration-guide.md';

/**
 * Version of the handoff text. Bump both whenever the text below changes (a unit test fails until you do),
 * so the Owner can tell at a glance whether the copy an App's AI received is the latest one.
 */
export const HANDOFF_VERSION = '2026-11-09.6';
export const HANDOFF_UPDATED = '2026-11-09 10:40（台灣時間）';

function list(values: readonly string[]): string {
  return values.length === 0 ? '（無）' : values.join('、');
}

/**
 * The instruction the Owner pastes to the AI that builds a new App. It carries only values that are
 * already public (nothing secret) and tells that AI how to connect to Starry ID, GitHub and Cloudflare
 * without touching Starry ID's code or asking for new Apple/Google console work.
 */
export function buildHandoff(app: AppEntry, origin: string, options: { battery: boolean; products?: readonly CatalogProduct[]; teamId?: string | null } = { battery: false }): string {
  const id = app.app_id;
  const lines = [
    `【串接指令版本 ${HANDOFF_VERSION}｜更新時間 ${HANDOFF_UPDATED}】`,
    `你是繁星生態系 App「${app.name}」的開發者 AI。Starry ID（繁星中央會員系統）已經替這款 App 登記完成，請照下面的資料串接。不需要、也不可以修改 Starry ID 的程式碼或設定。`,
    '如果這款 App 已經串接過：不要重做。請直接跳到「六、已串接 App 的更新檢查清單」，逐項檢查現有程式，只補上缺少或過時的部分，開 PR 後回報差異。',
    '',
    '【最重要的規則：每次更新，只補差異】已經串接過的 App 拿到新版串接指令時，禁止整份重做或重寫。先比對現有程式與新版指令，只改缺少或過時的部分；已經正常運作的程式一行都不要動。回報時只列「差異」：補了哪幾項、沒動哪些。',
    '',
    '## 一、已登記的資料（都不是秘密）',
    `- app_id：${id}`,
    `- 名稱：${app.name}`,
    `- iOS Bundle ID：${app.ios_bundle_id ?? '（無）'}`,
    `- Android package：${app.android_package ?? '（無）'}`,
    `- Apple Team ID（全生態系共用，由 Starry ID 中央設定，App 端不必也不可自己填）：${app.ios_team_id ?? options.teamId ?? '（業主尚未設定）'}`,
    `- Android 簽章憑證 SHA-256 指紋（Passkey 用，每款 App 各自登記，由業主在 Admin Lite 填寫）：${app.android_cert_sha256.length > 0 ? `已登記 ${app.android_cert_sha256.length} 組` : '（業主尚未登記；在登記之前 Android 原生 Passkey 不會成功，這不影響 Apple／Google 登入與網頁版）'}`,
    `- 網頁版來源（CORS 與登入回傳網址）：${list(app.web_origins)}`,
    `- App 深層連結回傳網址：${list(app.return_urls)}`,
    `- 最低版本：${app.min_version}`,
    `- Starry ID 網址：${origin}`,
    `- 驗證登記是否生效：GET ${origin}/v1/apps/${id}/config（應回傳 status 為 active）`,
    '',
    '## 二、先讀這兩份文件',
    `- 串接說明：${GUIDE_URL}（登入第 2 節、網頁版與 Android 登入中繼第 11.2 與 11.3 節、API 與換發第 3 節、帳號功能第 4 節）`,
    `- API 契約（OpenAPI 3.1）：https://raw.githubusercontent.com/starry-phd/id/main/openapi/starry-id.v1.json（請用它產生型別，不要手寫）`,
    '- App 前端單檔套件（手機與網頁都用）：https://raw.githubusercontent.com/starry-phd/id/main/sdk/starry-client.ts ，複製進 App 即可，沒有任何相依套件。登入中繼、Passkey、Token 儲存與換發（含並發鎖）、啟動檢查（維護／停用／需更新／公告）、帳號功能都已包好；不要自己重寫這些流程。用法在檔案開頭註解與串接說明附錄。',
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
    `   - Apple Team ID 已由 Starry ID 中央設定，所有 App 共用，你不用處理。業主要在 Admin Lite 的「編輯登記資料」為這款 App 登記 Android 簽章憑證 SHA-256 指紋（可以先留空、之後補填），Starry ID 會自動產生 Apple 與 Google 要求的網域驗證檔（${origin}/.well-known/apple-app-site-association、${origin}/.well-known/assetlinks.json）；指紋沒登記之前 Android 原生 Passkey 不會成功，Apple／Google 登入與網頁版不受影響，請不要對業主宣稱 Android Passkey 已可用。`,
    '   - 指紋要用「實際安裝在手機上的那個 APK」的簽章憑證：Google Play 上架版是 Play Console「應用程式簽署」的 App signing key certificate（不是 Upload key）；EAS 內部測試版或本機建置的 APK 簽章不同，要另外登記一組。請在回報中列出你的各種建置分別需要登記哪一組，並說明如何取得（例如 eas credentials 或 Play Console 路徑）。',
    `   - 新增 Passkey（設定頁放「新增 Passkey」「我的 Passkey」）：POST ${origin}/v1/me/passkeys/options（帶 Access Token；不限登入多久，隨時可新增）→ Passkey.create → POST ${origin}/v1/me/passkeys {clientDataJSON, attestationObject, name}。列出 GET /v1/me/passkeys，移除 DELETE /v1/me/passkeys/{id}。每位會員最多 10 把；Passkey 只是額外的登入方式，不能取代 Apple／Google，也不會建立新會員。`,
    '   - 錯誤處理：使用者取消不要顯示錯誤；InvalidStateError（這支裝置已有這把 Passkey）請白話說明；找不到 Passkey 時引導改用 Apple 或 Google 登入。',
    `   - 共用登入（單一登入，必做）：所有繁星 App 的登入狀態共用——在任一款 App 登入，同一支手機上的其他繁星 App 自動登入；登出或切換帳號，所有 App 都跟著登出或切換。做法：用 Starry SDK（sdk/starry-client.ts）建立 StarryClient 時傳入 sharedStorage。iPhone（必做）：所有繁星 App 一律使用同一個 Keychain 群組，名稱固定為 $(AppIdentifierPrefix)phd.starry.shared（業主不用在 Apple 後台另外設定，只要同一個 Apple 開發者帳號；你只要在這款 App 的專案設定 keychain-access-groups 加上這一個群組，Expo 在 app.json 的 ios.entitlements 設定，並用支援 access group 的鑰匙圈套件，例如 react-native-keychain 的 accessGroup 選項，把 sso_token 存進去，鍵名 starry.sso）。Android（選做，業主之後再決定，目前請略過，不要為此阻擋上架）：需要同簽章的共用通道。App 啟動與每次回到前景都呼叫 starry.syncDeviceSignIn()（restore() 已包含）。底層 API：登入後 POST ${origin}/v1/auth/sso/start（帶 Access Token，body 可帶 previous_sso_token）取得 sso_token 存進共用儲存；其他 App 用 POST ${origin}/v1/auth/sso/exchange {app_id:"${id}", sso_token} 換自己的登入；POST /v1/auth/sso/status {sso_token} 檢查是否已被登出或換人；登出用 POST /v1/auth/sso/logout {sso_token}（SDK 的 signOut() 已包含，會一併登出所有 App）。登出按鈕文字請寫「登出所有繁星 App」。`,
    `   - 網頁版也要共用登入（同一個瀏覽器內的所有繁星網頁版連動）：瀏覽器無法共用儲存，所以走 id.starry.phd。網頁版登入完成後呼叫 starry.shareWebSignIn({returnUrl})，讓 id.starry.phd 記住這個瀏覽器已登入；每次載入頁面（SDK 內建 5 分鐘節流）呼叫 starry.syncWebSignIn({returnUrl}) 詢問目前是誰；回到 returnUrl 時呼叫 starry.completeWebSsoCheck()（回傳 null 代表網址沒有結果，true／false 代表現在是否已登入）。returnUrl 必須是這款 App 已登記的網頁版來源底下的頁面（不能帶 #）。登出用 starry.signOutWebEverywhere({returnUrl})，會登出這個瀏覽器所有繁星網頁版。底層網址：${origin}/auth/sso/adopt、/auth/sso/check、/auth/sso/logout，以及 POST ${origin}/v1/auth/sso/web-code 與 /v1/auth/sso/web-exchange。限制：網頁版只在同一個瀏覽器內連動，手機 App 與網頁版之間不連動；網頁版在下一次載入頁面時才會跟上登出或換人。`,
    '4. 會員身分只用 Starry 的 user_id（內部以 provider＋sub 辨識，不用 Email 或姓名合併）。App 後端用 GET /.well-known/jwks.json 驗證 Access Token。',
    '   - 會員頭像（所有繁星 App 一致）：用 GET /v1/me 的 profile.avatar_url（簽名網址，1 小時有效，每次進畫面重新取得）。載入時一律用 new URL(avatar_url, "https://id.starry.phd") 轉成完整網址再載入：正式環境傳回完整的 https 網址，測試環境可能傳回以 / 開頭的路徑，兩種都要接受，不可只接受其中一種，否則會誤判成「沒有頭像」而顯示縮寫；avatar_url 為 null 時，在圓形裡顯示 profile.initials（姓與名各取第一個字，伺服器已算好，不要自己算）。頭像圖片的快取請用 avatar_url 問號前面的路徑當 key，不要用 user_id：會員換頭像（包含改用 Google 頭像）後路徑一定會變，所以每次 App 回到前景或進畫面都要重新讀 GET /v1/me，路徑不同就重新下載並更新所有畫面。會員顯示的名字一律用 profile.shown_name（會員在帳號中心指定的「主要顯示名稱」，暱稱或姓名二選一，預設暱稱，伺服器已算好，不要自己組；排行榜用 /v1/directory/members 的 shown_name 也一樣），shown_name 為 null 時才顯示 initials。頭像優先使用 Google 照片，會員可在 Starry 帳號中心自訂並裁切，所有 App 同步；App 內不要自己做頭像上傳或另存一份。會員的公開基本資料頁是 https://id.starry.phd/<會員編號>，邀請連結是 https://id.starry.phd/Invite/<會員編號>（Invite 後面有一個斜線）（會員編號用 GET /v1/me 的 member_no，格式是 2 個大寫英文字母的國家代碼加 7～10 位數字（預設是 0 開頭的 7 位，不夠用時會加長），例如 TW0123456，App 不要假設固定長度）。會員可以自己修改會員編號，修改後公開頁與邀請連結都會改變，所以 App 不可以把 member_no 當作資料的主鍵或檔案名稱，一律用 user_id（會員通行證的 sub）；每次要顯示或分享時重新讀 member_no。App 內若有「分享」入口請用原生分享功能表分享這個邀請連結。',
    '5. App 內必須提供串接說明第 4 節的帳號功能（登出、刪除帳號、同意條款等）。',
    '   - 設定頁（固定規範，所有繁星 App 完全一致，手機與網頁版相同）：整頁由上到下只有三個區塊，之後才是這款 App 自己的設定，三個區塊依序是「繁星電池艙」「我的中央會員」「我的 Passkey」。文字、順序與按鈕一律用官方 SDK（sdk/starry-client.ts）的 starrySettingsBlocks() 回傳的內容來畫，不可自己寫文字、改字或換順序。禁止加任何小字備註、括號說明、說明段落，也不要放「重新整理」「重新查詢」按鈕。',
    `   - 資料自動更新與按鈕動作：每次進入設定頁、App 回到前景時，自動重新讀 GET /v1/me、GET /v1/me/battery 與 Passkey 列表（頭像網址 1 小時有效）。頭像：profile.avatar_url 不是 null 就顯示照片，是 null 就顯示 initials 圓形縮寫，不要顯示任何「沒有頭像」的文字。按鈕：「電池消耗明細」＝POST ${origin}/v1/me/web-link {"page":"battery"}、「會員中心」＝{"page":"profile"}，兩者都用 App 內網頁視窗載入回傳的 url（單次、2 分鐘，已自動帶入登入，每次點擊重新要一個）；其他會員資料頁（referral、network、apps）同樣先呼叫 web-link；「公開基本資料」「分享邀請連結」用會員編號組網址；「聯絡客服」見下方客服入口；「登出所有繁星 App」「永久刪除中央帳號」依串接說明第 4 節。網頁版不可用 iframe 內嵌 Starry ID 頁面（會被拒絕），所以一律用 SDK 的內容自己畫。`,
    '   - Admin 專區（超級管理員專用，所有繁星 App 一致）：只有 GET /v1/me 回傳 staff_role 為 "owner" 時，才在「我的中央會員」區塊顯示「Admin 專區」按鈕（starrySettingsBlocks() 已自動處理：⚙ 齒輪圖示、反向填色、排在「聯絡客服」之後）。不可以用電子郵件判斷是不是管理員，一律看 staff_role。按鈕開啟這款 App 自己內部的管理員頁面，網址一律是 /admin（網頁版是 /admin 路徑；原生 App 是 App 內的 /admin 畫面），單獨管理這款 App 自己的功能。所有管理員專屬功能（管理、審核、查詢、設定、除錯、串接指令）一律集中在 /admin 這一頁，禁止散落在其他頁面或其他網址；現有 App 若已有散落各處的管理員功能，更新時要搬進 /admin（只搬移、不重寫功能），原位置移除入口。進入 /admin 時前端先看 staff_role，但真正的權限一定要在後端每個管理 API 再驗證一次（隱藏按鈕不算權限）。',
    '   - /admin 頁最上方固定放一張「串接指令」卡片：呼叫 starryClient.getLatestHandoff(目前採用的版本)（GET /v1/apps/{appId}/handoff?integrated=<版本>，只有 owner 能呼叫），顯示「目前採用版本」與「中央最新版本」；兩者相同顯示「已是最新」；不同就顯示「有新版」並提供「複製最新串接指令」按鈕，把回傳的 text 複製給這款 App 的 AI。卡片上要固定寫一行：「更新時請 AI 只補差異，不要整份重做」。「目前採用的版本」就是你這次完成所依據的串接指令版本（寫成 App 內一個常數，每次依新版指令更新完才改它）。',
    '   - 網頁版網址（所有繁星 App 網頁版一致，必做）：每一頁都要有自己的網址路徑（例如 /、/settings、/books、/search，有內容的頁面如 /courses/<id>），用 History API（pushState 與 popstate）切換頁面；重新整理、複製網址、分享網址、瀏覽器上一頁與下一頁都必須停留在同一頁，不可回到首頁，也不可把「目前頁面」只存在記憶體狀態。伺服端對所有不是檔案的路徑都回傳同一份 index.html（SPA fallback），網址不存在才顯示 404 與回首頁連結。需要登入的頁面：未登入時先記下目前路徑，登入完成後導回原本那一頁（回傳網址必須在已登記的網頁來源底下）。',
    `   - 會員資料頁（所有繁星 App 一致，不要在 App 內重做）：個人基本資料、生命靈數、推薦達人、組織網、App 列表，一律用「App 內的網頁視窗」開啟 Starry ID 的網頁（用 web-link 取得已登入的網址，page 分別是 profile、referral、network、apps）：iOS 用 SFSafariViewController 或 WKWebView，Android 用 Chrome Custom Tabs 或 WebView，畫面留在 App 裡，不可把使用者丟到外部瀏覽器 App（登入與客服除外）；改版時各 App 不用跟著更新。`,
    '   - 上架規範：App 的主要功能必須是原生畫面，網頁視窗只能用在上述會員資料頁；網頁視窗內不得販售數位商品，也不得引導到外部付款（付費一律走第 6 節 RevenueCat 與商店內購）。',
    '   - 電池圖示（固定規範，所有繁星 App、網頁、通知一致）：只要畫面或文字提到電池，就要在前面放對應的圖示，普通電池用 🔋，量子電池用 ⚛️。格式是「🔋 10 顆普通電池」「⚛️ 3 顆量子電池」，數量很緊湊的地方只放「🔋 10」「⚛️ 3」。不要自己換成別的圖示。',
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
    '3. 改用單檔 SDK：App 後端用 https://raw.githubusercontent.com/starry-phd/id/main/sdk/starry-sdk.ts（取代自己寫的 Battery 與會員呼叫）；App 前端（手機與網頁）用 https://raw.githubusercontent.com/starry-phd/id/main/sdk/starry-client.ts（取代自己寫的登入、Token 換發、啟動檢查與帳號呼叫）。',
    `4. 啟動時（以及每次回到前景）讀取 GET ${origin}/v1/apps/${id}/config：依 status 顯示維護或停用，低於 min_version 要求更新；其中的設定鍵值是公開內容，不放機密。status 變成 paused 有兩種原因：業主手動維護，或用量暴增保護自動暫停（這款 App 每小時 Battery 預留次數超過業主設定的上限），兩者處理方式相同：顯示維護畫面、不要自行重試轟炸，恢復由業主決定。`,
    '   - config 回應的 notices 是業主發布的公告（可指定這款 App 與時段，starts_at／ends_at 為毫秒時間戳）：有內容時在 App 內顯示（橫幅或可關閉的對話框），沒有就不顯示；公告文字只當純文字顯示，不要當 HTML 解析。',
    '5. 驗證 Token：快取 JWKS，遇到不認得的 kid 就重新抓取（金鑰輪替期間新舊並存）。',
    '6. 刪除帳號：立即永久刪除、沒有撤回期、不會自動取消商店訂閱；App 內說明文字要一致。',
    '7. 條款與隱私權政策有新版本：consent_required 為 true 時顯示同意流程。',
    '8. Passkey：登入頁（iOS、Android、網頁）要有「使用 Passkey 登入」，設定頁要能新增、列出、移除 Passkey，做法見「三、3」。電池加碼：會員在網頁帳號中心把越多基本資料欄位設為公開，免費電池的獲得倍數越高（預設 1.0 倍，每公開一個「有填內容」的欄位 +0.1 倍，空白欄位設為公開也不加成），由中央即時套用在每月免費電池與免費電池序號；App 一律照 /v1/me/battery 這類中央回傳的餘額顯示與扣款，不要自己乘倍數、也不要在 App 內做公開欄位的獎勵畫面。其餘不需要實作：序號與邀請碼（業主在後台「電池艙」產生；會員只在網頁 https://id.starry.phd/account 或點兌換網址兌換，取得免費電池或這款 App 的免費量子電池。App 內不要放序號輸入畫面，也不要連到兌換頁或提示會員去兌換，序號也不可販售，這是 App Store 與 Google Play 的內購規則）、公告與維護的設定（業主在後台操作；App 只要照第 4 項顯示）、資料匯出、通知類別開關（會員在帳號中心設定）。',
    `9. 設定頁改成固定版型（三、5）：只有「繁星電池艙」「我的中央會員」「我的 Passkey」三個區塊，都用 starrySettingsBlocks() 的內容畫，移除其他說明、小字、重新整理按鈕與自己畫的區塊；會員資料頁用 web-link 開啟。網頁版每一頁要有自己的網址，重新整理不回首頁（三、5「網頁版網址」）。客服入口：設定頁要有「聯絡客服」按鈕，開啟 ${origin}/support?app_id=${id}&app_version=…&device=…（做法見「三、5」）。`,
    `10. 後端跑在同一個 Cloudflare 帳號的 Worker 時，可以選用 Service Binding 內部直連 Starry ID（做法見串接說明第 14 節）：網址與標頭都不變，一定要帶 x-starry-app-key；這是選用的，不用也符合規範，改了要自行測試。`,
    '11. Admin 專區（三、5）：所有管理員功能集中在 /admin 一頁，散落在其他頁面的要搬進來；owner 才看得到「Admin 專區」按鈕，開啟 App 自己的 /admin 頁，頁面最上方有「串接指令」卡片（版本檢查＋複製最新指令＋「只補差異」提示），後端每個管理 API 都驗證 owner。',
    '12. 檢查完回報：每一項是「已符合」或「已補上（PR 連結）」，以及需要業主處理的事項。更新一律只補差異，不要重做已正常的部分。',
  ];
  return lines.filter((line, i) => !(line === '' && lines[i - 1] === '')).join('\n');
}
