import { html } from 'hono/html';
import { createInvite, listInvites, setInviteActive } from '../battery/invites';
import { adjustQuantum, listQuantumProducts, removeQuantumProduct, saveQuantumProduct } from '../battery/quantum';
import { getApp, type AppEntry } from '../apps/registry';
import { WEB_APP_ID } from '../identity/web-sessions';
import { type StaffActor } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { readForm, type WebContext } from './layout';
import { adminApp, adminPage, appAccess, staff, requireStepUp } from './admin-lib';
import { memberPage } from './admin-members';
import { appsPage } from './admin-apps';

async function quantumPage(c: WebContext, actor: StaffActor, app: AppEntry, message?: string): Promise<Response> {
  const owner = actor.role === 'owner';
  const products = await listQuantumProducts(c.env.DB_BATTERY, app.app_id);
  return c.html(
    adminPage(
      c,
      '量子電池',
      html`<h1>${app.name} 的量子電池</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p class="muted">會員可在這款 App 內購買「量子電池」加量包，只能在這款 App 使用。每次扣款先用免費的每月 Battery，用完才扣量子電池。這裡設定商店商品代碼（與 RevenueCat／商店的商品 ID 相同）對應多少顆。</p>
<div class="card"><table><thead><tr><th>商品代碼</th><th>顆數</th><th></th></tr></thead><tbody>
${products.map((p) => html`<tr><td><code>${p.product_id}</code></td><td>${p.units}</td><td>${owner ? html`<form method="post" action="/admin/apps/${app.app_id}/quantum/remove" class="inline"><input type="hidden" name="product_id" value="${p.product_id}"><button type="submit">移除</button></form>` : ''}</td></tr>`)}
</tbody></table>${products.length === 0 ? html`<p class="muted">尚未設定任何加量包，這款 App 目前不販售量子電池。</p>` : ''}</div>
${owner
  ? html`<h2>新增或修改</h2><div class="card"><form method="post" action="/admin/apps/${app.app_id}/quantum"><label for="product_id">商店商品代碼</label><input id="product_id" name="product_id" maxlength="200" required>
<label for="units">這個商品給幾顆（1～1000000）</label><input id="units" name="units" type="number" min="1" max="1000000" step="1" required><button type="submit">儲存</button></form></div>`
  : html`<p class="muted">只有 Owner 可以修改。</p>`}
<p class="muted">注意：購買的量子電池不會過期。退款（客服退款）會自動扣回尚未使用的部分。</p>
<p><a href="/admin/apps/${app.app_id}/handoff">回到串接指令</a></p>`,
    ),
  );
}

adminApp.get('/apps/:id/quantum', async (c) => {
  const actor = await appAccess(c, c.req.param('id'));
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  return quantumPage(c, actor, app);
});

adminApp.post('/apps/:id/quantum', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const now = Date.now();
  const ok = await saveQuantumProduct(c.env.DB_BATTERY, { appId: app.app_id, productId: (form.product_id ?? '').trim(), units: Number(form.units), actorUserId: actor.userId }, now);
  if (!ok) return quantumPage(c, actor, app, '商品代碼只能用英數與 . _ : -（最多 200 字），顆數為 1～1000000 的整數。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.quantum_product_saved', targetType: 'quantum_product', targetId: (form.product_id ?? '').trim().slice(0, 200), appId: app.app_id, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return quantumPage(c, actor, app, '已儲存。');
});

adminApp.post('/apps/:id/quantum/remove', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const productId = (form.product_id ?? '').trim().slice(0, 200);
  await removeQuantumProduct(c.env.DB_BATTERY, app.app_id, productId);
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.quantum_product_removed', targetType: 'quantum_product', targetId: productId, appId: app.app_id, result: 'success', requestId: actor.requestId, retention: 'security' }, Date.now()).run();
  return quantumPage(c, actor, app, '已移除。');
});

async function invitesPage(c: WebContext, actor: StaffActor, app: AppEntry, message?: string): Promise<Response> {
  const owner = actor.role === 'owner';
  const codes = await listInvites(c.env.DB_BATTERY, app.app_id);
  return c.html(
    adminPage(
      c,
      '邀請碼',
      html`<h1>${app.name} 的邀請碼</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p class="muted">會員在帳號中心輸入邀請碼，可獲得這款 App 的免費量子電池（只能在這款 App 使用、不會過期）。每位會員同一組邀請碼只能使用一次。</p>
<div class="card"><table><thead><tr><th>邀請碼</th><th>每人送</th><th>已用／上限</th><th>期限</th><th>狀態</th><th>備註</th><th></th></tr></thead><tbody>
${codes.map((i) => html`<tr><td><code>${i.code}</code></td><td>${i.units}</td><td>${i.used}／${i.max_uses}</td><td>${i.expires_at ? new Date(i.expires_at + 8 * 3600_000).toISOString().slice(0, 10) : '無'}</td><td>${i.active ? '啟用' : '停用'}</td><td>${i.note ?? ''}</td><td>${owner ? html`<form method="post" action="/admin/apps/${app.app_id}/invites/toggle" class="inline"><input type="hidden" name="code" value="${i.code}"><input type="hidden" name="active" value="${i.active ? '0' : '1'}"><button type="submit">${i.active ? '停用' : '啟用'}</button></form>` : ''}</td></tr>`)}
</tbody></table>${codes.length === 0 ? html`<p class="muted">還沒有邀請碼。</p>` : ''}</div>
${owner
  ? html`<h2>新增邀請碼</h2><div class="card"><form method="post" action="/admin/apps/${app.app_id}/invites">
<label for="inv-code">邀請碼（留空會自動產生；6～32 個英文大寫或數字）</label><input id="inv-code" name="code" maxlength="32" autocomplete="off">
<label for="inv-units">每人送幾顆量子電池（1～1000）</label><input id="inv-units" name="units" type="number" min="1" max="1000" step="1" value="10" required>
<label for="inv-max">最多可被使用幾次（1～100000）</label><input id="inv-max" name="max_uses" type="number" min="1" max="100000" step="1" value="100" required>
<label for="inv-exp">到期日（台灣時間，可留空＝不過期）</label><input id="inv-exp" name="expires" type="date">
<label for="inv-note">備註（給自己看，可留空）</label><input id="inv-note" name="note" maxlength="100">
<button type="submit">建立</button></form></div>`
  : html`<p class="muted">只有 Owner 可以新增或停用。</p>`}
<p><a href="/admin/apps/${app.app_id}/handoff">回到串接指令</a></p>`,
    ),
  );
}

adminApp.get('/apps/:id/invites', async (c) => {
  const actor = await appAccess(c, c.req.param('id'));
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  return invitesPage(c, actor, app);
});

adminApp.post('/apps/:id/invites', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const now = Date.now();
  // The expiry date is the end of that day in Taiwan time (UTC+8).
  const expiresAt = form.expires ? Date.parse(`${form.expires}T23:59:59+08:00`) : null;
  if (expiresAt !== null && Number.isNaN(expiresAt)) return invitesPage(c, actor, app, '到期日格式不正確。');
  const code = await createInvite(c.env.DB_BATTERY, { appId: app.app_id, code: form.code ?? '', units: Number(form.units), maxUses: Number(form.max_uses), expiresAt, note: form.note ?? '', actorUserId: actor.userId }, now);
  if (!code) return invitesPage(c, actor, app, '建立失敗：邀請碼需為 6～32 個英文大寫或數字且不能重複，顆數 1～1000、次數 1～100000、到期日必須在未來。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.invite_created', targetType: 'invite_code', targetId: code, appId: app.app_id, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return invitesPage(c, actor, app, `已建立邀請碼：${code}`);
});

adminApp.post('/apps/:id/invites/toggle', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const code = (form.code ?? '').trim().slice(0, 32);
  await setInviteActive(c.env.DB_BATTERY, app.app_id, code, form.active === '1');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: form.active === '1' ? 'admin.invite_enabled' : 'admin.invite_disabled', targetType: 'invite_code', targetId: code, appId: app.app_id, result: 'success', requestId: actor.requestId, retention: 'security' }, Date.now()).run();
  return invitesPage(c, actor, app, '已更新。');
});

adminApp.post('/members/:id/quantum', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const userId = c.req.param('id');
  if (userId === actor.userId) return memberPage(c, actor, userId, '不能調整自己的量子電池。');
  const exists = await c.env.DB_IDENTITY.prepare('SELECT 1 AS ok FROM users WHERE user_id = ?').bind(userId).first();
  if (!exists) return memberPage(c, actor, userId);
  const form = await readForm(c);
  const appId = form.app_id ?? '';
  if (!getApp(appId) || appId === WEB_APP_ID) return memberPage(c, actor, userId, '請選擇有效的 App。');
  const now = Date.now();
  const result = await adjustQuantum(c.env.DB_BATTERY, { userId, appId, delta: Number(form.delta), reason: form.reason ?? '', actorUserId: actor.userId }, now);
  if (!result.ok) return memberPage(c, actor, userId, result.reason === 'too_low' ? '調整後的量子電池不能低於 0。' : '請填寫非 0 的整數與 1～200 字的原因。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.quantum_adjusted', targetType: 'user', targetId: userId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return memberPage(c, actor, userId, `已調整，${appId} 的量子電池現為 ${result.balance.balance} 顆。`);
});

export const RC_STATE: Record<string, string> = { admin: '已在這裡設定', worker: '已由 Cloudflare Secret 設定', none: '尚未設定' };
