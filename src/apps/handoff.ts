import type { AppEntry } from './registry';

const GUIDE_URL = 'https://raw.githubusercontent.com/starry-phd/id/main/docs/integration-guide.md';

function list(values: readonly string[]): string {
  return values.length === 0 ? '（無）' : values.join('、');
}

/**
 * The instruction the Owner pastes to the AI that builds a new App. It carries only values that are
 * already public (nothing secret) and tells that AI how to connect to Starry ID, GitHub and Cloudflare
 * without touching Starry ID's code or asking for new Apple/Google console work.
 */
export function buildHandoff(app: AppEntry, origin: string, options: { battery: boolean } = { battery: false }): string {
  const id = app.app_id;
  const lines = [
    `你是繁星生態系新 App「${app.name}」的開發者 AI。Starry ID（繁星中央會員系統）已經替這款 App 登記完成，請照下面的資料串接。不需要、也不可以修改 Starry ID 的程式碼或設定。`,
    '',
    '## 一、已登記的資料（都不是秘密）',
    `- app_id：${id}`,
    `- 名稱：${app.name}`,
    `- iOS Bundle ID：${app.ios_bundle_id ?? '（無）'}`,
    `- Android package：${app.android_package ?? '（無）'}`,
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
    '4. 會員身分只用 Starry 的 user_id（內部以 provider＋sub 辨識，不用 Email 或姓名合併）。App 後端用 GET /.well-known/jwks.json 驗證 Access Token。',
    '5. App 內必須提供串接說明第 4 節的帳號功能（登出、刪除帳號、同意條款等）。',
    '6. 需要販售（RevenueCat）時，才依串接說明第 5 節處理；需要業主設定的項目，請列成清單回報給業主。',
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
    '- 已建立的 Repo 與 Worker 名稱、每個 PR 與 CI 結果。',
    `- 用 GET ${origin}/v1/apps/${id}/config 驗證的結果。`,
    '- 還需要業主處理的事項清單（只列確實需要業主的）。',
  ];
  return lines.filter((line, i) => !(line === '' && lines[i - 1] === '')).join('\n');
}
