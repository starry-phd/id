import { html } from 'hono/html';
import { randomToken } from '../lib/crypto';
import { revenueCatStatus, saveRevenueCatSecret } from '../billing/app-secrets';
import { configToText, loadConfigOverrides, parseConfigText, saveConfigOverrides } from '../apps/status';
import { appRegistry, getApp, type AppEntry, type AppStatus } from '../apps/registry';
import { setAppStage, setAppStatusOverride, STAGE_LABELS, type AppStage } from '../apps/status';
import { WEB_APP_ID } from '../identity/web-sessions';
import { type StaffActor } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { readForm, type WebContext } from './layout';
import { adminApp, adminPage, appAccess, staff } from './admin-lib';
import { appsPage, enableBatteryAndShow } from './admin-apps';
import { RC_STATE } from './admin-quantum';

async function revenueCatPage(c: WebContext, actor: StaffActor, app: AppEntry, message?: string, shownSecret?: string): Promise<Response> {
  const owner = actor.role === 'owner';
  const status = await revenueCatStatus(c.env, app.app_id);
  const url = `${new URL(c.req.url).origin}/v1/billing/revenuecat/${app.app_id}`;
  return c.html(
    adminPage(
      c,
      'RevenueCat 設定',
      html`<h1>${app.name} 的 RevenueCat</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
${shownSecret ? html`<div class="card"><p><strong>Webhook 驗證碼（只會顯示這一次）</strong></p><p>請複製後貼到 RevenueCat → Integrations → Webhooks 的「Authorization header value」，格式為：</p><input readonly value="Bearer ${shownSecret}" style="width:100%;font-family:monospace"></div>` : ''}
<div class="card"><p><strong>Webhook 網址：</strong><br><code>${url}</code></p>
<p>Webhook 驗證碼：${RC_STATE[status.webhook]} ｜ RevenueCat Secret API 金鑰：${RC_STATE[status.api]}</p></div>
${owner
  ? html`<div class="card"><form method="post" action="/admin/apps/${app.app_id}/revenuecat/webhook"><button type="submit">${status.webhook === 'none' ? '產生 Webhook 驗證碼' : '重新產生 Webhook 驗證碼（舊的立即失效）'}</button></form>
<form method="post" action="/admin/apps/${app.app_id}/revenuecat/api-key"><label for="api">RevenueCat Secret API 金鑰（用於刪除帳號時清除 RevenueCat 資料與每日對帳；儲存後不會再顯示）</label><input id="api" name="api_key" type="password" autocomplete="off" maxlength="300" placeholder="sk_..."><button type="submit">儲存金鑰</button></form>
<form method="post" action="/admin/apps/${app.app_id}/revenuecat/clear"><button type="submit" class="secondary">清除這裡設定的兩個值</button></form></div>`
  : html`<p class="muted">只有 Owner 可以修改。</p>`}
<p class="muted">金鑰以加密方式保存，不會出現在紀錄或匯出。請勿把金鑰貼給 AI 或任何人。</p>
<p><a href="/admin/apps/${app.app_id}/handoff">回到串接指令</a></p>`,
    ),
  );
}

function rcApp(c: WebContext): AppEntry | null {
  const app = getApp(c.req.param('id') ?? '');
  return app && app.app_id !== WEB_APP_ID ? app : null;
}

adminApp.get('/apps/:id/revenuecat', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const app = rcApp(c);
  return app ? revenueCatPage(c, actor, app) : appsPage(c, '找不到此 App。');
});

async function rcAudit(c: WebContext, actor: StaffActor, appId: string, action: string): Promise<void> {
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action, targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, Date.now()).run();
}

adminApp.post('/apps/:id/revenuecat/webhook', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = rcApp(c);
  if (!app) return appsPage(c, '找不到此 App。');
  const secret = randomToken(32);
  if (!(await saveRevenueCatSecret(c.env, { appId: app.app_id, kind: 'webhook', value: secret, actorUserId: actor.userId }, Date.now()))) return revenueCatPage(c, actor, app, '無法加密保存（缺少 DATA_ENCRYPTION_KEY），請先在 Cloudflare 設定。');
  await rcAudit(c, actor, app.app_id, 'admin.revenuecat_webhook_set');
  return revenueCatPage(c, actor, app, '已產生新的 Webhook 驗證碼。', secret);
});

adminApp.post('/apps/:id/revenuecat/api-key', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = rcApp(c);
  if (!app) return appsPage(c, '找不到此 App。');
  const value = ((await readForm(c)).api_key ?? '').trim();
  if (value.length < 8 || value.length > 300) return revenueCatPage(c, actor, app, '請貼上完整的 RevenueCat Secret API 金鑰。');
  if (!(await saveRevenueCatSecret(c.env, { appId: app.app_id, kind: 'api', value, actorUserId: actor.userId }, Date.now()))) return revenueCatPage(c, actor, app, '無法加密保存（缺少 DATA_ENCRYPTION_KEY），請先在 Cloudflare 設定。');
  await rcAudit(c, actor, app.app_id, 'admin.revenuecat_api_key_set');
  return revenueCatPage(c, actor, app, '已儲存 API 金鑰。');
});

adminApp.post('/apps/:id/revenuecat/clear', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = rcApp(c);
  if (!app) return appsPage(c, '找不到此 App。');
  await saveRevenueCatSecret(c.env, { appId: app.app_id, kind: 'webhook', value: null, actorUserId: actor.userId }, Date.now());
  await saveRevenueCatSecret(c.env, { appId: app.app_id, kind: 'api', value: null, actorUserId: actor.userId }, Date.now());
  await rcAudit(c, actor, app.app_id, 'admin.revenuecat_cleared');
  return revenueCatPage(c, actor, app, '已清除。');
});

async function configPage(c: WebContext, actor: StaffActor, app: AppEntry, message?: string, text?: string): Promise<Response> {
  const canEdit = actor.role === 'owner' || actor.role === 'admin';
  const current = await loadConfigOverrides(c.env.DB_IDENTITY, app.app_id);
  return c.html(
    adminPage(
      c,
      '遠端設定',
      html`<h1>${app.name} 的遠端設定</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p class="muted">App 每次啟動會讀取這些值（<code>GET /v1/apps/${app.app_id}/config</code>），例如功能開關、公告文字、最低版本。這裡的內容是公開的，<strong>不要放任何金鑰或密碼</strong>。約 30 秒內生效。</p>
<div class="card"><p><strong>預設值（來自程式設定）：</strong> 最低版本 <code>${app.min_version}</code>${Object.keys(app.config).length > 0 ? html`，${Object.entries(app.config).map(([k, v]) => html`<code>${k} = ${JSON.stringify(v)}</code> `)}` : ''}</p></div>
${canEdit
  ? html`<form method="post" action="/admin/apps/${app.app_id}/config" class="card"><label for="cfg">覆寫設定（每行一個，寫成「名稱 = 值」；名稱用小寫英文、數字、底線；<code>min_version</code> 可覆寫最低版本；整個清空＝全部還原預設）</label>
<textarea id="cfg" name="config" rows="10" maxlength="6000" style="font-family:monospace">${text ?? configToText(current)}</textarea>
<p class="muted">範例：<br><code>new_feature = true</code><br><code>max_upload_mb = 20</code><br><code>notice = "週末維護"</code><br><code>min_version = 1.2.0</code></p><button type="submit">儲存</button></form>`
  : html`<div class="card"><pre>${configToText(current) || '（沒有覆寫）'}</pre></div><p class="muted">只有 Owner 與 Admin 可以修改。</p>`}
<p><a href="/admin/apps/${app.app_id}/handoff">回到串接指令</a></p>`,
    ),
  );
}

adminApp.get('/apps/:id/config', async (c) => {
  const actor = await appAccess(c, c.req.param('id'));
  if (actor instanceof Response) return actor;
  const app = rcApp(c);
  return app ? configPage(c, actor, app) : appsPage(c, '找不到此 App。');
});

adminApp.post('/apps/:id/config', async (c) => {
  const actor = await appAccess(c, c.req.param('id'));
  if (actor instanceof Response) return actor;
  const app = rcApp(c);
  if (!app) return appsPage(c, '找不到此 App。');
  const text = (await readForm(c)).config ?? '';
  const parsed = parseConfigText(text);
  if (!parsed.ok) return configPage(c, actor, app, parsed.error, text);
  await saveConfigOverrides(c.env.DB_IDENTITY, actor, app.app_id, parsed.values, Date.now());
  return configPage(c, actor, app, '已儲存，約 30 秒內生效。');
});

adminApp.post('/apps/:id/battery-key', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  return enableBatteryAndShow(c, actor, c.req.param('id'), 'Battery 已開通，服務金鑰已更新（舊金鑰立即失效）。');
});

adminApp.post('/apps/:id/status', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const appId = c.req.param('id');
  if (!appRegistry.has(appId)) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const value = form.status;
  const status: AppStatus | null | undefined = value === 'default' ? null : value === 'active' || value === 'paused' || value === 'killed' ? value : undefined;
  if (status === undefined) return appsPage(c, '請選擇狀態。');
  const reason = (form.reason ?? '').trim().slice(0, 200) || null;
  await setAppStatusOverride(c.env.DB_IDENTITY, actor, appId, status, reason, Date.now());
  return appsPage(c, `${appId} 已更新為 ${status ?? '預設值'}。`);
});

adminApp.post('/apps/:id/stage', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const appId = c.req.param('id');
  if (!appRegistry.has(appId)) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const now = Date.now();
  if (!(await setAppStage(c.env.DB_IDENTITY, appId, form.stage_value ?? '', actor.userId, now))) return appsPage(c, '請選擇階段。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.app_stage_set', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return appsPage(c, `${appId} 的階段已改為「${STAGE_LABELS[form.stage_value as AppStage]}」。`);
});
