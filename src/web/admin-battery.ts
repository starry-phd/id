import { html } from 'hono/html';
import { getNotices, saveNotices } from '../lib/notices';
import { appRegistry, getApp } from '../apps/registry';
import { appMonthUsage, setAppCap, MAX_RESERVATION_UNITS, getPolicy, setPolicy } from '../battery/battery';
import { WEB_APP_ID } from '../identity/web-sessions';
import { type StaffActor } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { formatTime, readForm, type WebContext } from './layout';
import { adminApp, adminPage, staff } from './admin-lib';
import { TIMEOUT_SECONDS } from './admin-members';

async function batteryPage(c: WebContext, actor: StaffActor, message?: string): Promise<Response> {
  const db = c.env.DB_BATTERY;
  const policy = await getPolicy(db);
  const owner = actor.role === 'owner';
  const apps = [...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID);
  const keyed = new Set((await db.prepare('SELECT app_id FROM battery_app_keys').all<{ app_id: string }>()).results.map((r) => r.app_id));
  const caps = new Map((await db.prepare('SELECT app_id, monthly_cap FROM battery_app_limits').all<{ app_id: string; monthly_cap: number }>()).results.map((r) => [r.app_id, r.monthly_cap]));
  const used = new Map<string, number>(await Promise.all(apps.map(async (a) => [a.app_id, await appMonthUsage(db, a.app_id, Date.now())] as [string, number])));
  return c.html(
    adminPage(
      c,
      'Battery',
      html`<h1>Starry Battery</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p class="muted">Starry 會員共用的免費 AI 用量月額度，每月 1 日（台灣時間）恢復，不累積、不能購買或轉讓。App 後端預留額度、成功才扣除，失敗或逾時自動歸還。</p>
<h2>每月額度</h2>
<div class="card">
<p>每位會員每月 <strong>${policy.monthly_allowance}</strong> 顆｜預設逾時 ${TIMEOUT_SECONDS(policy.default_timeout_ms)} 秒${policy.updated_at ? html`<br><span class="muted">最後修改：${formatTime(policy.updated_at)}</span>` : ''}</p>
${owner
  ? html`<form method="post" action="/admin/battery/policy"><label for="allowance">每位會員每月幾顆（0～1000000）</label><input id="allowance" name="allowance" type="number" min="0" max="1000000" step="1" value="${policy.monthly_allowance}" required>
<label for="timeout">預設逾時秒數（10～3600）</label><input id="timeout" name="timeout" type="number" min="10" max="3600" step="1" value="${TIMEOUT_SECONDS(policy.default_timeout_ms)}" required>
<button type="submit">儲存</button><p class="muted">修改額度會同時套用到本月：每位會員本月額度增減同樣數量，但不會低於已使用＋預留。</p></form>`
  : html`<p class="muted">只有 Owner 可以修改。</p>`}
</div>
<h2>各 App 的服務金鑰</h2>
<div class="card">
<p class="muted">每款 App 一把金鑰，只放在該 App 的後端。每個 AI 功能扣幾顆，由各 App 自己的設定頁決定（只有超級管理員能改）；Starry 只限制單次預留最多 ${MAX_RESERVATION_UNITS} 顆。</p>
<table><thead><tr><th>App</th><th>金鑰</th><th>本月用量／上限</th></tr></thead><tbody>
${apps.map((a) => html`<tr><td>${a.name}<br><code>${a.app_id}</code></td><td>${keyed.has(a.app_id) ? '已建立' : '尚未建立'}&nbsp;&nbsp;<a href="/admin/apps/${a.app_id}/handoff">${owner ? '查看／重新產生' : '查看'}</a></td><td>${used.get(a.app_id) ?? 0}／${caps.get(a.app_id) ?? '不限'}${owner ? html`<form method="post" action="/admin/battery/apps/${a.app_id}/cap" class="inline"><input name="cap" type="number" min="0" step="1" placeholder="上限（0＝不限）" required><button type="submit">設定</button></form>` : ''}</td></tr>`)}
</tbody></table>
</div>`,
    ),
  );
}

adminApp.get('/battery', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return batteryPage(c, actor);
});

adminApp.post('/battery/apps/:id/cap', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const appId = c.req.param('id');
  if (!getApp(appId) || appId === WEB_APP_ID) return batteryPage(c, actor, '找不到此 App。');
  const form = await readForm(c);
  const value = Number(form.cap);
  const now = Date.now();
  if (!(await setAppCap(c.env.DB_BATTERY, appId, value === 0 ? null : value, actor.userId, now))) return batteryPage(c, actor, '上限請填 0（不限）或 1～1000000000 的整數。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.battery_app_cap_set', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return batteryPage(c, actor, value === 0 ? '已取消上限。' : '已設定每月上限。');
});

async function noticesPage(c: WebContext, actor: StaffActor, message?: string): Promise<Response> {
  const n = await getNotices(c.env.DB_IDENTITY);
  const owner = actor.role === 'owner';
  return c.html(
    adminPage(
      c,
      '公告與維護模式',
      html`<h1>公告與維護模式</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
${n.maintenance ? html`<div class="banner danger">目前為維護模式：新的 Battery 任務會被暫停（進行中的任務仍可結算），登入與帳號功能不受影響。</div>` : ''}
<div class="card">${owner
  ? html`<form method="post" action="/admin/notices"><label for="a">公告（顯示在會員中心，最多 500 字，留空＝不顯示）</label><textarea id="a" name="announcement" maxlength="500" rows="3">${n.announcement}</textarea>
<label><input type="checkbox" name="maintenance" value="1" ${n.maintenance ? 'checked' : ''}> 開啟維護模式（暫停新的 Battery 任務）</label>
<label for="m">維護說明（最多 500 字）</label><textarea id="m" name="maintenance_message" maxlength="500" rows="3">${n.maintenanceMessage}</textarea><button type="submit">儲存</button></form>`
  : html`<p>公告：${n.announcement || '（無）'}</p><p>維護模式：${n.maintenance ? '開啟' : '關閉'}</p><p class="muted">只有 Owner 可以修改。</p>`}</div>
<p><a href="/admin">回到首頁</a></p>`,
    ),
  );
}

adminApp.get('/notices', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return noticesPage(c, actor);
});

adminApp.post('/notices', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const form = await readForm(c);
  const now = Date.now();
  const ok = await saveNotices(c.env.DB_IDENTITY, { announcement: form.announcement ?? '', maintenance: form.maintenance === '1', maintenanceMessage: form.maintenance_message ?? '' }, actor.userId, now);
  if (!ok) return noticesPage(c, actor, '公告與說明各最多 500 字。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.notices_saved', targetType: 'system', targetId: 'notices', result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return noticesPage(c, actor, '已儲存。');
});

adminApp.post('/battery/policy', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const form = await readForm(c);
  const now = Date.now();
  const ok = await setPolicy(c.env.DB_BATTERY, { monthlyAllowance: Number(form.allowance), defaultTimeoutMs: Number(form.timeout) * 1000, actorUserId: actor.userId }, now);
  if (!ok) return batteryPage(c, actor, '請輸入 0～1000000 的額度與 10～3600 秒的逾時。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.battery_policy_updated', targetType: 'battery_policy', targetId: 'monthly', result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return batteryPage(c, actor, '已更新每月額度。');
});
