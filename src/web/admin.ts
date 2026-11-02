import { Hono } from 'hono';
import { html } from 'hono/html';
import { appRegistry, type AppStatus } from '../apps/registry';
import { listAppStatusOverrides, setAppStatusOverride } from '../apps/status';
import type { AppBindings } from '../env';
import { listAudit } from '../identity/audit-query';
import { hasRole, isRecentLogin, restoreMember, roleOf, searchMembers, setStaffRole, suspendMember, type Role, type StaffActor, type StatusChangeResult } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { CATEGORY_LABELS, getTicket, listTickets, setTicketStatus } from '../support/tickets';
import { formatTime, page, readForm, sameOrigin, webContext, type Html, type WebContext } from './layout';

/**
 * Spec S-ADM-01 Admin Lite: server-rendered, phone-friendly, Starry ID sign-in plus a
 * role check on every request. Support can read; Admin can suspend, restore and switch
 * App status; only the Owner manages staff roles. Sensitive writes need a sign-in from the
 * last 10 minutes (S-ID-10).
 */
export const adminApp = new Hono<AppBindings>();
adminApp.use('*', webContext, sameOrigin);

const STATUS_LABELS: Record<string, string> = { active: '正常', suspended: '停權', pending_deletion: '刪除中' };
const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', admin: 'Admin', support: 'Support' };
const RESULT_TEXT: Record<StatusChangeResult, string> = {
  ok: '已完成。',
  not_found: '找不到此會員。',
  not_allowed: '你的角色不能對此會員執行這個操作。',
  wrong_status: '會員目前的狀態不允許這個操作。',
};

async function staff(c: WebContext, minimum: Role): Promise<StaffActor | Response> {
  const web = c.get('web');
  if (!web) return c.redirect(`/account?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 303);
  const role = web.status === 'active' ? await roleOf(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, web.userId) : null;
  if (!role || !hasRole(role, minimum)) {
    return c.html(page(c, '沒有權限', html`<h1>沒有權限</h1><p>此頁面需要 ${ROLE_LABELS[minimum]} 以上的角色。</p>`, { admin: true }), 403);
  }
  return { userId: web.userId, role, requestId: c.get('requestId') };
}

/** Sensitive writes: the sign-in must be at most 10 minutes old. */
async function needsReauth(c: WebContext): Promise<Response | null> {
  const web = c.get('web');
  if (web && isRecentLogin(web.createdAt, Date.now())) return null;
  return c.html(
    page(
      c,
      '請重新登入',
      html`<h1>請重新登入</h1><div class="banner">這個操作需要 10 分鐘內登入的身分確認。請登出後重新登入，再回到這一頁操作。</div>
<form method="post" action="/account/logout"><button type="submit">登出並重新登入</button></form>`,
      { admin: true },
    ),
    403,
  );
}

const nav = html`<p><a href="/admin/members">會員</a>&emsp;<a href="/admin/tickets">客服單</a>&emsp;<a href="/admin/apps">App 狀態</a>&emsp;<a href="/admin/audit">稽核紀錄</a></p>`;

function adminPage(c: WebContext, title: string, body: Html): Html {
  return page(c, title, html`${nav}${body}`, { admin: true });
}

adminApp.get('/', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const db = c.env.DB_IDENTITY;
  const [members, open] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM users'),
    db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'"),
  ]);
  const count = (r: typeof members) => Number((r?.results[0] as { n?: number } | undefined)?.n ?? 0);
  return c.html(
    adminPage(
      c,
      'Admin Lite',
      html`<h1>Admin Lite</h1><p class="muted">你的角色：${ROLE_LABELS[actor.role]}</p>
<div class="card"><p>會員總數：<strong>${count(members)}</strong></p><p>未結客服單：<strong>${count(open)}</strong></p></div>`,
    ),
  );
});

adminApp.get('/members', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const q = c.req.query('q') ?? '';
  const result = await searchMembers(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, { query: q, cursor: c.req.query('cursor') });
  return c.html(
    adminPage(
      c,
      '會員',
      html`<h1>會員</h1>
<form method="get" action="/admin/members" class="card"><label for="q">以會員編號或完整 Email 查詢</label><input id="q" name="q" value="${q}"><button type="submit">查詢</button></form>
<table><thead><tr><th>會員</th><th>狀態</th><th>登入方式</th><th>加入</th></tr></thead><tbody>
${result.members.map(
  (m) => html`<tr><td><a href="/admin/members/${m.user_id}">${m.display_name ?? '（未命名）'}</a><br><code>${m.user_id}</code>${m.role ? html`<br>${ROLE_LABELS[m.role]}` : ''}</td>
<td>${STATUS_LABELS[m.status] ?? m.status}</td><td>${m.providers.join('、')}<br><span class="muted">${m.emails.filter((e) => e !== null).join('、')}</span></td><td>${formatTime(m.created_at)}</td></tr>`,
)}
</tbody></table>
${result.members.length === 0 ? html`<p class="muted">沒有符合的會員。</p>` : ''}
${result.nextCursor ? html`<p class="pager"><a href="/admin/members?cursor=${result.nextCursor}">下一頁</a></p>` : ''}`,
    ),
  );
});

async function memberPage(c: WebContext, actor: StaffActor, userId: string, message?: string): Promise<Response> {
  const db = c.env.DB_IDENTITY;
  const { members } = await searchMembers(db, c.env.OWNER_USER_IDS, { query: userId });
  const m = members[0];
  if (!m) return c.html(adminPage(c, '找不到會員', html`<h1>找不到會員</h1>`), 404);
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.member_viewed', targetType: 'user', targetId: m.user_id, result: 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
  const canModerate = hasRole(actor.role, 'admin') && m.role !== 'owner' && m.user_id !== actor.userId;
  return c.html(
    adminPage(
      c,
      '會員資料',
      html`<h1>${m.display_name ?? '（未命名）'}</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<div class="card">
<p><strong>會員編號：</strong><code>${m.user_id}</code><br>
<strong>狀態：</strong>${STATUS_LABELS[m.status] ?? m.status}${m.status_reason ? html`（${m.status_reason}）` : ''}<br>
<strong>角色：</strong>${m.role ? ROLE_LABELS[m.role] : '一般會員'}<br>
<strong>登入方式：</strong>${m.providers.join('、')}（${m.emails.filter((e) => e !== null).join('、') || '無 Email'}）<br>
<strong>加入：</strong>${formatTime(m.created_at)}</p>
<p><a href="/admin/audit?member=${m.user_id}">查看此會員的稽核紀錄</a></p>
</div>
${canModerate && m.status === 'active'
  ? html`<h2>停權</h2><form method="post" action="/admin/members/${m.user_id}/suspend" class="card"><label for="reason">原因（必填，最多 200 字，會員看不到）</label><input id="reason" name="reason" maxlength="200" required><button class="danger" type="submit">停權</button></form>`
  : ''}
${canModerate && m.status === 'suspended'
  ? html`<h2>復權</h2><form method="post" action="/admin/members/${m.user_id}/restore" class="card"><p>復權後會員需要重新登入。</p><button type="submit">復權</button></form>`
  : ''}
${actor.role === 'owner' && m.role !== 'owner' && m.user_id !== actor.userId
  ? html`<h2>管理角色</h2><form method="post" action="/admin/members/${m.user_id}/role" class="card"><label for="role">角色</label>
<select id="role" name="role"><option value="none">一般會員</option><option value="support">Support</option><option value="admin">Admin</option></select><button type="submit">更新角色</button></form>`
  : ''}`,
    ),
  );
}

adminApp.get('/members/:id', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return memberPage(c, actor, c.req.param('id'));
});

adminApp.post('/members/:id/suspend', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  const reason = ((await readForm(c)).reason ?? '').trim();
  if (reason.length < 1 || reason.length > 200) return memberPage(c, actor, c.req.param('id'), '請填寫 1～200 字的停權原因。');
  const result = await suspendMember(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, c.req.param('id'), reason, Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.post('/members/:id/restore', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  const result = await restoreMember(c.env.DB_IDENTITY, actor, c.req.param('id'), Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.post('/members/:id/role', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  const value = (await readForm(c)).role;
  const role = value === 'admin' || value === 'support' ? value : value === 'none' ? null : undefined;
  if (role === undefined) return memberPage(c, actor, c.req.param('id'), '請選擇角色。');
  const result = await setStaffRole(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, c.req.param('id'), role, Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.get('/tickets', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const status = c.req.query('status') === 'closed' ? 'closed' : 'open';
  const result = await listTickets(c.env.DB_IDENTITY, { status, cursor: c.req.query('cursor') });
  return c.html(
    adminPage(
      c,
      '客服單',
      html`<h1>客服單</h1>
<p>${status === 'open' ? html`<strong>未結</strong>&emsp;<a href="/admin/tickets?status=closed">已結</a>` : html`<a href="/admin/tickets">未結</a>&emsp;<strong>已結</strong>`}</p>
<table><thead><tr><th>時間</th><th>類別</th><th>內容</th></tr></thead><tbody>
${result.tickets.map(
  (t) => html`<tr><td><a href="/admin/tickets/${t.ticket_id}">${formatTime(t.created_at)}</a></td><td>${CATEGORY_LABELS[t.category]}${t.app_id ? html`<br><span class="muted">${t.app_id}</span>` : ''}</td><td>${t.message.length > 80 ? `${t.message.slice(0, 80)}…` : t.message}</td></tr>`,
)}
</tbody></table>
${result.tickets.length === 0 ? html`<p class="muted">沒有客服單。</p>` : ''}
${result.nextCursor ? html`<p class="pager"><a href="/admin/tickets?status=${status}&cursor=${result.nextCursor}">下一頁</a></p>` : ''}`,
    ),
  );
});

async function ticketPage(c: WebContext, actor: StaffActor, ticketId: string, message?: string): Promise<Response> {
  const db = c.env.DB_IDENTITY;
  const t = await getTicket(db, ticketId);
  if (!t) return c.html(adminPage(c, '找不到客服單', html`<h1>找不到客服單</h1>`), 404);
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.ticket_viewed', targetType: 'ticket', targetId: t.ticket_id, result: 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
  return c.html(
    adminPage(
      c,
      '客服單',
      html`<h1>客服單</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<div class="card">
<p class="muted">${formatTime(t.created_at)}｜${CATEGORY_LABELS[t.category]}${t.app_id ? `｜${t.app_id}` : ''}｜${t.status === 'open' ? '未結' : `已結（${formatTime(t.closed_at)}）`}</p>
<p style="white-space:pre-wrap">${t.message}</p>
<p><strong>回覆對象：</strong>${t.contact_email ?? '（會員，請以會員登入 Email 回覆）'}${t.user_id ? html`<br><a href="/admin/members/${t.user_id}">查看會員</a>` : ''}</p>
${t.staff_note ? html`<p><strong>內部備註：</strong>${t.staff_note}</p>` : ''}
</div>
<form method="post" action="/admin/tickets/${t.ticket_id}/status" class="card">
<label for="note">內部備註（選填，最多 1000 字）</label><textarea id="note" name="note" maxlength="1000" rows="3"></textarea>
<input type="hidden" name="status" value="${t.status === 'open' ? 'closed' : 'open'}">
<button type="submit">${t.status === 'open' ? '結案' : '重新開啟'}</button>
</form>`,
    ),
  );
}

adminApp.get('/tickets/:id', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return ticketPage(c, actor, c.req.param('id'));
});

adminApp.post('/tickets/:id/status', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const form = await readForm(c);
  const status = form.status === 'closed' ? 'closed' : 'open';
  const note = (form.note ?? '').trim().slice(0, 1000) || null;
  const ok = await setTicketStatus(c.env.DB_IDENTITY, actor, c.req.param('id'), status, note, Date.now());
  return ticketPage(c, actor, c.req.param('id'), ok ? (status === 'closed' ? '已結案。' : '已重新開啟。') : '找不到客服單。');
});

async function appsPage(c: WebContext, message?: string): Promise<Response> {
  const overrides = await listAppStatusOverrides(c.env.DB_IDENTITY);
  return c.html(
    adminPage(
      c,
      'App 狀態',
      html`<h1>App 狀態</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p class="muted">預設值來自 Repo 的 config/apps.json；在這裡設定的狀態會覆蓋預設值，30 秒內生效。paused：App 顯示維護中；killed：停用此 App 的登入與服務，不影響其他 App。</p>
${[...appRegistry.values()].map((app) => {
  const o = overrides.get(app.app_id);
  return html`<form method="post" action="/admin/apps/${app.app_id}/status" class="card">
<p><strong>${app.name}</strong> <code>${app.app_id}</code><br>預設：${app.status}｜目前：<strong>${o?.status ?? app.status}</strong>${o?.reason ? html`（${o.reason}）` : ''}</p>
<label>新狀態</label><select name="status"><option value="default">使用預設</option><option value="active">active</option><option value="paused">paused</option><option value="killed">killed</option></select>
<label>原因（最多 200 字）</label><input name="reason" maxlength="200">
<button type="submit">更新</button></form>`;
})}`,
    ),
  );
}

adminApp.get('/apps', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return appsPage(c);
});

adminApp.post('/apps/:id/status', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
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

adminApp.get('/audit', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const member = c.req.query('member') ?? '';
  const action = c.req.query('action') ?? '';
  const result = await listAudit(c.env.DB_IDENTITY, { memberId: member || undefined, actionPrefix: action || undefined, cursor: c.req.query('cursor') });
  const query = (cursor: string) => `/admin/audit?${new URLSearchParams({ ...(member ? { member } : {}), ...(action ? { action } : {}), cursor }).toString()}`;
  return c.html(
    adminPage(
      c,
      '稽核紀錄',
      html`<h1>稽核紀錄</h1>
<form method="get" action="/admin/audit" class="card"><label for="member">會員編號</label><input id="member" name="member" value="${member}">
<label for="action">動作開頭（例如 auth.login、admin.）</label><input id="action" name="action" value="${action}"><button type="submit">篩選</button></form>
<table><thead><tr><th>時間</th><th>動作</th><th>操作者 → 對象</th><th>結果</th></tr></thead><tbody>
${result.rows.map(
  (r) => html`<tr><td>${formatTime(r.occurred_at)}</td><td><code>${r.action}</code>${r.app_id ? html`<br><span class="muted">${r.app_id}</span>` : ''}</td>
<td><span class="muted">${r.actor_type}</span> ${r.actor_user_id ?? ''}<br>→ ${r.target_type ?? ''} ${r.target_id ?? ''}</td><td>${r.result}</td></tr>`,
)}
</tbody></table>
${result.nextCursor ? html`<p class="pager"><a href="${query(result.nextCursor)}">下一頁</a></p>` : ''}`,
    ),
  );
});
