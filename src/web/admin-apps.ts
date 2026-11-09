import { html } from 'hono/html';
import { appOverview } from '../apps/overview';
import { appChecks, gatherStatus, pendingItems } from '../apps/integration-status';
import { centralTeamId } from '../apps/team-id';
import { definitionFromForm, invalidRegisteredApps, listRegisteredAppIds, saveRegisteredApp, type AppForm } from '../apps/dynamic';
import { listCatalog } from '../apps/catalog';
import { buildHandoff, HANDOFF_UPDATED, HANDOFF_VERSION } from '../apps/handoff';
import { appRegistry, getApp, type AppEntry } from '../apps/registry';
import { APP_STAGES, listAppStages, listAppStatusOverrides, STAGE_LABELS } from '../apps/status';
import { enableAppBattery, hasAppBatteryKey } from '../battery/battery';
import { WEB_APP_ID } from '../identity/web-sessions';
import { hasRole, roleOf, type Role, type StaffActor } from '../identity/roles';
import { revenueSummary } from '../billing/revenue';
import { auditStatement } from '../lib/audit';
import { readForm, type WebContext } from './layout';
import { adminApp, adminPage, requireStepUp, staff } from './admin-lib';
import { BLOCKER_TEXT, previewReset, resetAppData, type ResetCounts } from '../apps/reset';

export async function appsPage(c: WebContext, message?: string): Promise<Response> {
  const overrides = await listAppStatusOverrides(c.env.DB_IDENTITY);
  const stages = await listAppStages(c.env.DB_IDENTITY);
  const registered = await listRegisteredAppIds(c.env.DB_IDENTITY);
  const stats = await appOverview({ identity: c.env.DB_IDENTITY, billing: c.env.DB_BILLING, battery: c.env.DB_BATTERY }, Date.now());
  const statusInputs = await gatherStatus(c.env, appRegistry.values());
  const invalid = invalidRegisteredApps();
  // Revenue is an Admin-and-above figure (same rule as /admin/revenue); support staff never see it on the cards.
  const web = c.get('web');
  const viewer = web ? await roleOf(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, web.userId) : null;
  const revenue = hasRole(viewer, 'admin') ? new Map((await revenueSummary(c.env.DB_BILLING, Date.now() - 30 * 86400_000)).filter((r) => !r.sandbox).map((r) => [r.appId, r])) : null;
  return c.html(
    adminPage(
      c,
      'App',
      html`<h1>App</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
${invalid.length > 0 ? html`<div class="banner danger">這些 App 的登記資料目前無法通過檢查：${invalid.join('、')}。系統暫時沿用上一次正常的版本，請到「編輯登記資料」修正後儲存。</div>` : ''}
<div class="actions"><a class="button" href="/admin/apps/new">新增 App</a><a class="button secondary" href="/admin/apps/status">整合狀態總覽</a><a class="button secondary" href="/admin/launcher">九宮格 App</a></div>
<p class="muted">所有 App 都登記在資料庫，不必改程式碼，30 秒內生效。paused：App 顯示維護中；killed：停用此 App 的登入與服務，不影響其他 App。</p>
<div class="grid">${appRegistry.values().filter((app) => app.app_id !== WEB_APP_ID).map((app) => {
  const o = overrides.get(app.app_id);
  const own = registered.has(app.app_id);
  const st = stats.get(app.app_id);
  const current = o?.status ?? app.status;
  // The hidden one-click form must be a sibling of the card form (forms cannot nest); the button joins it through its form="" attribute.
  const quickForm = current === 'active'
    ? html`<form id="pause-${app.app_id}" method="post" action="/admin/apps/${app.app_id}/status"><input type="hidden" name="status" value="paused"><input type="hidden" name="reason" value="後台一鍵暫停"></form>`
    : html`<form id="pause-${app.app_id}" method="post" action="/admin/apps/${app.app_id}/status"><input type="hidden" name="status" value="default"></form>`;
  const quick = current === 'active'
    ? html`<button type="submit" form="pause-${app.app_id}" class="danger">一鍵暫停</button>`
    : html`<button type="submit" form="pause-${app.app_id}">恢復為預設狀態</button>`;
  const stage = stages.get(app.app_id) ?? 'dev';
  const inputs = statusInputs.get(app.app_id);
  const pending = inputs ? pendingItems(appChecks(app, inputs, c.env)).filter((t) => /Passkey/.test(t)) : [];
  const badge = current === 'active' ? 'ok' : current === 'paused' ? 'warn' : 'bad';
  return html`<form id="stage-${app.app_id}" method="post" action="/admin/apps/${app.app_id}/stage"></form>${quickForm}<form method="post" action="/admin/apps/${app.app_id}/status" class="card">
<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start">
<div><strong style="font-size:1.1rem">${app.name}</strong><br><code>${app.app_id}</code> <span class="muted">${own ? '後台登記' : '固定在程式設定檔'}</span></div>
<div><span class="badge ${badge}">${current}</span> <span class="badge">${STAGE_LABELS[stage]}</span></div>
</div>
${o?.reason ? html`<p class="muted">狀態原因：${o.reason}（預設 ${app.status}）</p>` : ''}
<div class="chips"><span>會員 <strong>${st?.members ?? 0}</strong></span><span>近 24 小時活躍 <strong>${st?.day ?? 0}</strong></span><span>7 天內 <strong>${st?.week ?? 0}</strong></span><span>30 天內 <strong>${st?.month ?? 0}</strong></span><span>有效權益 <strong>${st?.entitlements ?? 0}</strong></span></div>
<div class="chips"><span>本月 Battery <strong>${st?.batteryUsed ?? 0}</strong>${st?.batteryCap != null ? ` ／ 上限 ${st.batteryCap}` : ''}</span><span>近 24 小時用量 <strong>${st?.batteryUsed24h ?? 0}</strong></span><span>每小時暴增上限 ${st?.hourlyLimit != null ? html`<strong>${st.hourlyLimit}</strong>` : '未設定'}</span></div>
<div class="chips"><span>最低版本 <strong>${st?.minVersionOverride ?? app.min_version ?? '0.0.0'}</strong>${st?.minVersionOverride ? '（遠端設定）' : '（預設）'}</span><span>未結客服單 <a href="/admin/tickets?app=${app.app_id}"><strong>${st?.openTickets ?? 0}</strong></a></span></div>
${pending.length > 0 ? html`<p class="muted">⚠ ${pending.join(' ')}（<a href="/admin/apps/status">看全部</a>）</p>` : ''}
<div class="actions"><a class="button" href="/admin/apps/${app.app_id}/handoff">給開發 AI 的串接指令</a>${own ? html`<a class="button secondary" href="/admin/apps/${app.app_id}/edit">編輯登記資料</a>` : ''}${quick}</div>
<details><summary>更多設定與操作</summary>
<div class="links">${revenue ? html`<a href="/admin/apps/${app.app_id}/config">遠端設定</a><a href="/admin/apps/${app.app_id}/products">商品目錄</a><a href="/admin/apps/${app.app_id}/quantum">量子電池</a><a href="/admin/apps/${app.app_id}/invites">邀請碼</a>` : ''}${viewer === 'owner' && stage !== 'live' ? html`<a href="/admin/apps/${app.app_id}/reset">清除測試資料</a>` : ''}</div>
${revenue ? html`<p>近 30 天營收（估計，USD）<strong>${(revenue.get(app.app_id)?.revenueUsd ?? 0).toFixed(2)}</strong>｜退款 ${(revenue.get(app.app_id)?.refundedUsd ?? 0).toFixed(2)}｜新訂閱 ${revenue.get(app.app_id)?.newPurchases ?? 0}｜退訂 ${revenue.get(app.app_id)?.cancellations ?? 0}｜<a href="/admin/revenue">營收明細</a></p>` : ''}
<p>階段：<strong>${STAGE_LABELS[stage]}</strong>
<select name="stage_value" form="stage-${app.app_id}">${APP_STAGES.map((st2) => html`<option value="${st2}"${stage === st2 ? ' selected' : ''}>${STAGE_LABELS[st2]}</option>`)}</select> <button type="submit" form="stage-${app.app_id}" class="secondary">改階段</button></p>
<label>新狀態</label><select name="status"><option value="default">使用預設</option><option value="active">active</option><option value="paused">paused</option><option value="killed">killed</option></select>
<label>原因（最多 200 字）</label><input name="reason" maxlength="200">
<button type="submit">更新</button></details></form>`;
})}</div>`,
    ),
  );
}

/** True when any advanced field already has a value, so the section opens by itself. */
function advancedFilled(values: AppForm): boolean {
  return [values.ios_bundle_id, values.android_package, values.web_origins, values.scheme, values.return_urls, values.min_version, values.extra_apple_audiences, values.extra_google_audiences].some((v) => (v ?? '').trim() !== '');
}

function appForm(c: WebContext, mode: 'create' | 'update', values: AppForm, message?: string): Response | Promise<Response> {
  const create = mode === 'create';
  return c.html(
    adminPage(
      c,
      create ? '新增 App' : '編輯 App',
      html`<h1>${create ? '新增 App' : `編輯 ${values.app_id ?? ''}`}</h1>
${message ? html`<div class="banner danger">${message}</div>` : ''}
<form method="post" action="${create ? '/admin/apps/new' : `/admin/apps/${values.app_id ?? ''}/edit`}" class="card">
<label for="app_id">app_id（小寫英文、數字、連字號，建立後不能改）</label><input id="app_id" name="app_id" value="${values.app_id ?? ''}" pattern="[a-z][a-z0-9-]{1,31}" placeholder="clock" required ${create ? '' : 'readonly'}>
<label for="name">名稱</label><input id="name" name="name" value="${values.name ?? ''}" maxlength="80" placeholder="繁星時鐘 Clock" required>
<p class="muted">iOS、Android、網頁三個平台，以及 Starry Battery 都會自動開通；Bundle ID、套件名稱、網頁網址都會依 app_id 自動產生。</p>
<p class="muted">Apple Team ID：全生態系共用，由中央設定為 <code>${centralTeamId(c.env) ?? '（尚未設定）'}</code>，這裡不用填。</p>
<label for="android_cert_sha256">Android 簽章憑證 SHA-256 指紋（選填，可以先留空，取得後到「編輯登記資料」補填；每行一組）</label><textarea id="android_cert_sha256" name="android_cert_sha256" rows="2" placeholder="AA:BB:CC:…（Play Console → 應用程式簽署 → App signing key certificate 的 SHA-256）">${values.android_cert_sha256 ?? ''}</textarea>
<p class="muted">沒填也能建立 App 並完成串接，只是 Android 原生 Passkey 要等指紋登記後才會成功。上架版用 Play 的「App signing key」指紋（不是 Upload key）；內部測試 APK 的簽章不同，另行加一行。</p>
<details${create && !advancedFilled(values) ? '' : ' open'}><summary>進階（通常不用填，需要才展開）</summary>
<label for="ios_bundle_id">iOS Bundle ID（留空＝自動：phd.starry.&lt;app_id&gt;）</label><input id="ios_bundle_id" name="ios_bundle_id" value="${values.ios_bundle_id ?? ''}">
<label for="android_package">Android package（留空＝自動：phd.starry.&lt;app_id&gt;）</label><input id="android_package" name="android_package" value="${values.android_package ?? ''}">
<label for="web_origins">網頁版來源（每行一個；留空＝自動：https://&lt;app_id&gt;.starry.phd）</label><textarea id="web_origins" name="web_origins" rows="2">${values.web_origins ?? ''}</textarea>
<label for="scheme">App 深層連結 scheme（留空＝自動：app_id）</label><input id="scheme" name="scheme" value="${values.scheme ?? ''}">
<label for="return_urls">額外的深層連結回傳網址（每行一個，留空＝自動）</label><textarea id="return_urls" name="return_urls" rows="2">${values.return_urls ?? ''}</textarea>
<label for="min_version">最低版本（留空＝0.0.0）</label><input id="min_version" name="min_version" value="${values.min_version ?? ''}" pattern="\d+\.\d+\.\d+">
<label for="extra_apple_audiences">額外的 Apple 登入對象（每行一個，改用原生登入才需要）</label><textarea id="extra_apple_audiences" name="extra_apple_audiences" rows="2">${values.extra_apple_audiences ?? ''}</textarea>
<label for="extra_google_audiences">額外的 Google 用戶端 ID（每行一個，改用原生登入才需要）</label><textarea id="extra_google_audiences" name="extra_google_audiences" rows="2">${values.extra_google_audiences ?? ''}</textarea>
</details>
<button type="submit">${create ? '建立並產生串接指令' : '儲存'}</button></form>`,
    ),
    message ? 400 : 200,
  );
}

function formFromEntry(app: AppEntry): AppForm {
  const shared = getApp(WEB_APP_ID);
  const sharedApple = new Set([...(shared?.auth.apple ?? []), ...(app.ios_bundle_id ? [app.ios_bundle_id] : [])]);
  const sharedGoogle = new Set(shared?.auth.google ?? []);
  return {
    app_id: app.app_id,
    name: app.name,
    ios_bundle_id: app.ios_bundle_id ?? '',
    android_package: app.android_package ?? '',
    web_origins: app.web_origins.join('\n'),
    return_urls: app.return_urls.join('\n'),
    min_version: app.min_version,
    android_cert_sha256: app.android_cert_sha256.join('\n'),
    extra_apple_audiences: app.auth.apple.filter((a) => !sharedApple.has(a)).join('\n'),
    extra_google_audiences: app.auth.google.filter((a) => !sharedGoogle.has(a)).join('\n'),
  };
}

adminApp.get('/apps', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return appsPage(c);
});

adminApp.get('/apps/new', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  return appForm(c, 'create', {});
});

adminApp.post('/apps/new', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const form = (await readForm(c)) as AppForm;
  const built = definitionFromForm(form, { defaults: true });
  if (!built.ok) return appForm(c, 'create', form, built.error);
  const result = await saveRegisteredApp(c.env.DB_IDENTITY, actor, built.app, 'create', Date.now());
  if (result === 'reserved' || result === 'exists') return appForm(c, 'create', form, '這個 app_id 已被使用，請換一個。');
  return enableBatteryAndShow(c, actor, built.app.app_id, '已建立並開通 Battery，30 秒內生效。');
});

adminApp.get('/apps/:id/edit', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID || !(await listRegisteredAppIds(c.env.DB_IDENTITY)).has(app.app_id)) return appsPage(c, '只有在後台登記的 App 可以在這裡編輯（登入中樞 account 是固定的內部服務，不能改）。');
  return appForm(c, 'update', formFromEntry(app));
});

adminApp.post('/apps/:id/edit', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  // Editing a registration can change who may sign in (audiences, origins, return URLs), so it needs the Passkey check too.
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const form = { ...((await readForm(c)) as AppForm), app_id: c.req.param('id') };
  const built = definitionFromForm(form);
  if (!built.ok) return appForm(c, 'update', form, built.error);
  const result = await saveRegisteredApp(c.env.DB_IDENTITY, actor, built.app, 'update', Date.now());
  if (result !== 'updated') return appsPage(c, '找不到這個後台登記的 App。');
  return c.redirect(`/admin/apps/${built.app.app_id}/handoff?updated=1`, 303);
});

async function handoffPage(c: WebContext, role: Role, app: AppEntry, notice: string, serviceKey?: string): Promise<Response> {
  const hasKey = serviceKey !== undefined || (await hasAppBatteryKey(c.env.DB_BATTERY, app.app_id));
  const text = buildHandoff(app, new URL(c.req.url).origin, { battery: hasKey, products: await listCatalog(c.env.DB_IDENTITY, app.app_id), teamId: centralTeamId(c.env) });
  const regenerate =
    role === 'owner'
      ? html`<form method="post" action="/admin/apps/${app.app_id}/battery-key" class="inline"><button type="submit">${hasKey ? '重新產生 Battery 服務金鑰' : '開通 Battery'}</button></form>`
      : '';
  const reported = await c.env.DB_IDENTITY.prepare('SELECT integrated_version, reported_at FROM app_handoff_reports WHERE app_id = ?').bind(app.app_id).first<{ integrated_version: string; reported_at: number }>();
  const adopted = reported ? (reported.integrated_version === HANDOFF_VERSION ? `${reported.integrated_version}（已是最新）` : `${reported.integrated_version}（待升級，只補差異）`) : '尚未回報（App 的 /admin 頁第一次開啟後會回報）';
  const nonce = c.get('cspNonce');
  return c.html(
    adminPage(
      c,
      '串接指令',
      html`<h1>${app.name} 的串接指令</h1>
${notice ? html`<div class="banner">${notice}</div>` : ''}
<div class="card" style="text-align:center"><p class="muted" style="margin:0">目前的串接指令版本</p><p style="font-size:2em;font-weight:bold;margin:4px 0">${HANDOFF_VERSION}</p><p style="font-size:1.2em;margin:0">更新時間：${HANDOFF_UPDATED}</p><p class="muted" style="margin:6px 0 0">AI 回報的版本號碼和這裡一樣，就是最新版；不一樣就請它重新使用下面這份指令。</p></div>
<p class="muted">這款 App 回報採用的版本：${adopted}</p>
<h2>① 給 AI 的</h2>
<div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between"><strong>給開發 AI 的串接指令</strong><button type="button" data-copy="handoff-text">複製給AI指令（不含金鑰）</button></div>
<p class="muted">整段貼給負責開發這款 App 的 AI。內容只有已登記的公開資料，<strong>沒有任何金鑰</strong>；請不要把下面「給你自己的」那一塊貼給 AI。</p>
<textarea id="handoff-text" readonly rows="24" style="width:100%;font-family:monospace">${text}</textarea></div>
<h2>② 給你自己的</h2>
<div class="card"><p><strong>Battery 服務金鑰</strong>（只給你自己用，<strong>不要貼給 AI</strong>）</p>
${serviceKey
  ? html`<p class="muted">只顯示這一次，請現在複製保存，並自己貼到這款 App 後端的 Cloudflare Secret（名稱 STARRY_BATTERY_KEY）。不要貼進 App、Git、AI 對話或公開的地方。遺失或外洩就重新產生，舊金鑰立即失效。</p>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="battery-key" readonly value="${serviceKey}" style="flex:1;min-width:220px;font-family:monospace"><button type="button" data-copy="battery-key">複製金鑰</button>${regenerate}</div>`
  : html`<p class="muted">${hasKey ? '已開通；金鑰只在建立或重新產生時顯示一次。' : '尚未開通。'}</p><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${regenerate}</div>`}
</div>
<p><a href="/admin/apps/${app.app_id}/products">商品目錄（商店商品 ID 與權益）</a></p>
<p><a href="/admin/apps/${app.app_id}/quantum">量子電池（內購加量包）設定</a></p>
<p><a href="/admin/apps/${app.app_id}/invites">邀請碼（送免費量子電池）</a></p>
<p><a href="/admin/apps/${app.app_id}/config">遠端設定（App 啟動時讀取）</a></p>
<p><a href="/admin/apps/${app.app_id}/revenuecat">RevenueCat 設定（Webhook 與 API 金鑰）</a></p>
<p><a href="/admin/apps">回到 App 清單</a></p>`,
      html`<script nonce="${nonce}">
document.querySelectorAll('[data-copy]').forEach(function (button) {
  button.addEventListener('click', function () {
    var field = document.getElementById(button.getAttribute('data-copy'));
    var label = button.textContent;
    var done = function () { button.textContent = '已複製'; setTimeout(function () { button.textContent = label; }, 1500); };
    field.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(field.value).then(done, function () { document.execCommand('copy'); done(); });
    } else { document.execCommand('copy'); done(); }
  });
});
</script>`,
    ),
  );
}

export async function enableBatteryAndShow(c: WebContext, actor: StaffActor, appId: string, notice: string): Promise<Response> {
  const app = getApp(appId);
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const now = Date.now();
  const enabled = await enableAppBattery(c.env.DB_BATTERY, appId, actor.userId, now);
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.battery_key_created', targetType: 'battery_key', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  c.header('cache-control', 'no-store');
  return handoffPage(c, actor.role, app, notice, enabled.serviceKey);
}

adminApp.get('/apps/:id/handoff', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  return handoffPage(c, actor.role, app, c.req.query('created') ? '已建立，30 秒內生效。' : c.req.query('updated') ? '已儲存。' : '');
});

const COUNT_LABELS: [keyof ResetCounts, string][] = [
  ['sessions', '登入狀態（會員會被登出這款 App）'],
  ['memberApps', '使用紀錄（用過這款 App 的會員）'],
  ['pushTokens', '推播裝置'],
  ['pushPreferences', '推播類別設定'],
  ['entitlements', '訂閱與買斷權益'],
  ['grants', '客服補發的權益'],
  ['rcEvents', 'RevenueCat 事件紀錄'],
  ['quantumAccounts', '量子電池餘額'],
  ['quantumLedger', '量子電池流水'],
  ['inviteRedemptions', '邀請碼兌換紀錄（邀請碼本身保留，已用次數歸零）'],
];

async function resetPage(c: WebContext, appId: string, message?: string): Promise<Response> {
  const app = getApp(appId);
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const preview = await previewReset({ identity: c.env.DB_IDENTITY, billing: c.env.DB_BILLING, battery: c.env.DB_BATTERY }, appId, Date.now());
  return c.html(
    adminPage(
      c,
      '清除測試資料',
      html`<h1>清除測試資料：${app.name}</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<div class="card"><p>階段：<strong>${STAGE_LABELS[preview.stage]}</strong>（只有「開發中」或「測試中」才能清除）</p>
<table><thead><tr><th>會被刪除的資料</th><th>筆數</th></tr></thead><tbody>${COUNT_LABELS.map(([key, label]) => html`<tr><td>${label}</td><td>${preview.counts[key]}</td></tr>`)}</tbody></table>
<p class="muted"><strong>不會動：</strong>會員帳號、稽核紀錄、這款 App 的登記與設定、客服單、全站共用的免費 Battery。刪除後無法復原。</p></div>
${preview.blockers.length > 0
  ? html`<div class="banner danger">${preview.blockers.map((b) => html`<p>${BLOCKER_TEXT[b]}</p>`)}</div>`
  : html`<form method="post" action="/admin/apps/${appId}/reset" class="card"><label for="confirm">請輸入 App 代碼 <code>${appId}</code> 以確認</label><input id="confirm" name="confirm" autocomplete="off" required><button class="danger" type="submit">永久清除測試資料</button></form>`}
<p><a href="/admin/apps">回到 App 列表</a></p>`,
    ),
  );
}

adminApp.get('/apps/:id/reset', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  return resetPage(c, c.req.param('id'));
});

adminApp.post('/apps/:id/reset', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const appId = c.req.param('id');
  const app = getApp(appId);
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  if (((await readForm(c)).confirm ?? '').trim() !== appId) return resetPage(c, appId, '請輸入正確的 App 代碼才能清除。');
  const result = await resetAppData({ identity: c.env.DB_IDENTITY, billing: c.env.DB_BILLING, battery: c.env.DB_BATTERY }, actor, appId, Date.now());
  if (!result.ok) return resetPage(c, appId, '目前不能清除，原因見下方。');
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
  return resetPage(c, appId, `已清除 ${total} 筆測試資料。`);
});
