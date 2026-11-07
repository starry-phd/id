import { html } from 'hono/html';
import { definitionFromForm, listRegisteredAppIds, saveRegisteredApp, type AppForm } from '../apps/dynamic';
import { buildHandoff } from '../apps/handoff';
import { appRegistry, getApp, type AppEntry } from '../apps/registry';
import { APP_STAGES, listAppStages, listAppStatusOverrides, STAGE_LABELS } from '../apps/status';
import { enableAppBattery, hasAppBatteryKey } from '../battery/battery';
import { WEB_APP_ID } from '../identity/web-sessions';
import { type Role, type StaffActor } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { readForm, type WebContext } from './layout';
import { adminApp, adminPage, staff } from './admin-lib';

export async function appsPage(c: WebContext, message?: string): Promise<Response> {
  const overrides = await listAppStatusOverrides(c.env.DB_IDENTITY);
  const stages = await listAppStages(c.env.DB_IDENTITY);
  const registered = await listRegisteredAppIds(c.env.DB_IDENTITY);
  return c.html(
    adminPage(
      c,
      'App',
      html`<h1>App</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p><a class="button" href="/admin/apps/new">新增 App</a></p>
<p class="muted">新增的 App 存在資料庫，不必改程式碼，30 秒內生效。Repo 的 config/apps.json 是既有 App 的預設值；在這裡設定的狀態會覆蓋預設值。paused：App 顯示維護中；killed：停用此 App 的登入與服務，不影響其他 App。</p>
${appRegistry.values().filter((app) => app.app_id !== WEB_APP_ID).map((app) => {
  const o = overrides.get(app.app_id);
  const own = registered.has(app.app_id);
  return html`<form id="stage-${app.app_id}" method="post" action="/admin/apps/${app.app_id}/stage"></form><form method="post" action="/admin/apps/${app.app_id}/status" class="card">
<p><strong>${app.name}</strong> <code>${app.app_id}</code>（${own ? '後台登記' : 'config/apps.json'}）<br>預設：${app.status}｜目前：<strong>${o?.status ?? app.status}</strong>${o?.reason ? html`（${o.reason}）` : ''}</p>
<p><a href="/admin/apps/${app.app_id}/handoff">給開發 AI 的串接指令</a>${own ? html`&emsp;<a href="/admin/apps/${app.app_id}/edit">編輯登記資料</a>` : ''}</p>
<p>階段：<strong>${STAGE_LABELS[stages.get(app.app_id) ?? 'dev']}</strong>
<select name="stage_value" form="stage-${app.app_id}">${APP_STAGES.map((st) => html`<option value="${st}"${(stages.get(app.app_id) ?? 'dev') === st ? ' selected' : ''}>${STAGE_LABELS[st]}</option>`)}</select> <button type="submit" form="stage-${app.app_id}" class="secondary">改階段</button></p>
<label>新狀態</label><select name="status"><option value="default">使用預設</option><option value="active">active</option><option value="paused">paused</option><option value="killed">killed</option></select>
<label>原因（最多 200 字）</label><input name="reason" maxlength="200">
<button type="submit">更新</button></form>`;
})}`,
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
  if (!app || app.app_id === WEB_APP_ID || !(await listRegisteredAppIds(c.env.DB_IDENTITY)).has(app.app_id)) return appsPage(c, '只有在後台登記的 App 可以編輯；config/apps.json 的 App 請由 Claude 修改。');
  return appForm(c, 'update', formFromEntry(app));
});

adminApp.post('/apps/:id/edit', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const form = { ...((await readForm(c)) as AppForm), app_id: c.req.param('id') };
  const built = definitionFromForm(form);
  if (!built.ok) return appForm(c, 'update', form, built.error);
  const result = await saveRegisteredApp(c.env.DB_IDENTITY, actor, built.app, 'update', Date.now());
  if (result !== 'updated') return appsPage(c, '找不到這個後台登記的 App。');
  return c.redirect(`/admin/apps/${built.app.app_id}/handoff?updated=1`, 303);
});

async function handoffPage(c: WebContext, role: Role, app: AppEntry, notice: string, serviceKey?: string): Promise<Response> {
  const hasKey = serviceKey !== undefined || (await hasAppBatteryKey(c.env.DB_BATTERY, app.app_id));
  const text = buildHandoff(app, new URL(c.req.url).origin, { battery: hasKey });
  const regenerate =
    role === 'owner'
      ? html`<form method="post" action="/admin/apps/${app.app_id}/battery-key" class="inline"><button type="submit">${hasKey ? '重新產生 Battery 服務金鑰' : '開通 Battery'}</button></form>`
      : '';
  const nonce = c.get('cspNonce');
  return c.html(
    adminPage(
      c,
      '串接指令',
      html`<h1>${app.name} 的串接指令</h1>
${notice ? html`<div class="banner">${notice}</div>` : ''}
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
