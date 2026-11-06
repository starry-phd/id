import { Hono } from 'hono';
import { html } from 'hono/html';
import { definitionFromForm, listRegisteredAppIds, saveRegisteredApp, type AppForm } from '../apps/dynamic';
import { buildHandoff } from '../apps/handoff';
import { appRegistry, getApp, type AppEntry, type AppStatus } from '../apps/registry';
import { listAppStatusOverrides, setAppStatusOverride } from '../apps/status';
import { background } from '../auth/routes';
import { adjustAllowance, enableAppBattery, getBalance, hasAppBatteryKey, getPolicy, listTaskTypes, setPolicy, staffLedger, upsertTaskType } from '../battery/battery';
import type { AppBindings } from '../env';
import { listAudit } from '../identity/audit-query';
import { WEB_APP_ID } from '../identity/web-sessions';
import { hasRole, isRecentLogin, restoreMember, roleOf, searchMembers, setStaffRole, suspendMember, type Role, type StaffActor, type StatusChangeResult } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { mailSettings, notifyStaffChange } from '../notify/email';
import { ATTACHMENT_EXTENSIONS, getAttachment, listAttachments } from '../support/attachments';
import { listReplies, replyRecipient, replyToTicket } from '../support/replies';
import { CATEGORY_LABELS, getTicket, listTickets, setTicketStatus } from '../support/tickets';
import { formatTime, page, readForm, sameOrigin, webContext, type Html, type WebContext } from './layout';

/**
 * Spec S-ADM-01 Admin Lite: server-rendered, phone-friendly, Starry ID sign-in plus a
 * role check on every request. Support can read; Admin can suspend, restore, adjust a
 * member's Battery and switch App status; only the Owner manages staff roles and the
 * Battery policy. Sensitive writes need a sign-in from the
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

const nav = html`<p><a href="/admin/members">會員</a>&emsp;<a href="/admin/tickets">客服單</a>&emsp;<a href="/admin/battery">Battery</a>&emsp;<a href="/admin/apps">App</a>&emsp;<a href="/admin/audit">稽核紀錄</a></p>`;

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
  const canAdjust = hasRole(actor.role, 'admin') && m.user_id !== actor.userId;
  const now = Date.now();
  const [balance, ledger] = await Promise.all([getBalance(c.env.DB_BATTERY, m.user_id, now), staffLedger(c.env.DB_BATTERY, m.user_id, 10)]);
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
<h2>Starry Battery（${balance.period}）</h2>
<div class="card">
<p>本月額度 <strong>${balance.allowance}</strong> 顆｜已使用 ${balance.used}｜預留中 ${balance.reserved}｜剩餘 <strong>${balance.remaining}</strong> 顆<br>
<span class="muted">下次恢復：${formatTime(balance.resets_at)}</span></p>
${ledger.length > 0
  ? html`<table><thead><tr><th>時間</th><th>項目</th><th>數量</th></tr></thead><tbody>
${ledger.map((e) => html`<tr><td>${formatTime(e.created_at)}</td><td>${e.kind === 'usage' ? html`${e.task_label ?? e.task_type ?? ''}<br><span class="muted">${e.app_id ?? ''}</span>` : html`人工調整：${e.reason ?? ''}`}</td><td>${e.kind === 'usage' ? `-${e.amount}` : e.amount > 0 ? `+${e.amount}` : `${e.amount}`}</td></tr>`)}
</tbody></table>`
  : html`<p class="muted">沒有使用紀錄。</p>`}
${canAdjust
  ? html`<form method="post" action="/admin/members/${m.user_id}/battery"><label for="delta">調整本月額度（顆；正數增加、負數減少，不能低於已使用＋預留）</label><input id="delta" name="delta" type="number" step="1" required>
<label for="battery-reason">原因（必填，最多 200 字，會員看不到）</label><input id="battery-reason" name="reason" maxlength="200" required><button type="submit">調整</button>
<p class="muted">調整後會寄通知信給會員，只說明額度被調整，不寫數字。</p></form>`
  : ''}
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

adminApp.post('/members/:id/battery', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  const userId = c.req.param('id');
  if (userId === actor.userId) return memberPage(c, actor, userId, '不能調整自己的 Battery。');
  const exists = await c.env.DB_IDENTITY.prepare('SELECT 1 AS ok FROM users WHERE user_id = ?').bind(userId).first();
  if (!exists) return memberPage(c, actor, userId);
  const form = await readForm(c);
  const delta = Number(form.delta);
  const now = Date.now();
  const result = await adjustAllowance(c.env.DB_BATTERY, { userId, delta, reason: form.reason ?? '', actorUserId: actor.userId }, now);
  if (!result.ok) {
    return memberPage(c, actor, userId, result.reason === 'too_low' ? '調整後的額度不能低於本月已使用＋預留中的數量。' : '請填寫非 0 的整數與 1～200 字的原因。');
  }
  const db = c.env.DB_IDENTITY;
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.battery_adjusted', targetType: 'user', targetId: userId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  const notice = background(c, notifyStaffChange(db, mailSettings(c.env, new URL(c.req.url).origin), userId, 'Starry Battery 本月額度'));
  if (notice) await notice;
  return memberPage(c, actor, userId, `已調整，本月額度現為 ${result.balance.allowance} 顆。`);
});

const TIMEOUT_SECONDS = (ms: number | null) => (ms === null ? '' : String(Math.round(ms / 1000)));

async function batteryPage(c: WebContext, actor: StaffActor, message?: string): Promise<Response> {
  const db = c.env.DB_BATTERY;
  const [policy, tasks] = await Promise.all([getPolicy(db), listTaskTypes(db)]);
  const owner = actor.role === 'owner';
  const apps = [...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID);
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
<h2>AI 任務類型與消耗</h2>
<table><thead><tr><th>任務</th><th>每單位消耗（顆）</th><th>單次上限</th><th>逾時</th><th>狀態</th></tr></thead><tbody>
${tasks.map((t) => html`<tr><td>${t.label}<br><code>${t.task_type}</code></td><td>${t.unit_cost}</td><td>${t.max_units} 單位</td><td>${t.timeout_ms === null ? '預設' : `${TIMEOUT_SECONDS(t.timeout_ms)} 秒`}</td><td>${t.enabled ? '啟用' : '停用'}</td></tr>`)}
</tbody></table>
${tasks.length === 0 ? html`<p class="muted">尚未設定任務類型；App 後端要先有任務類型才能預留 Battery。</p>` : ''}
${owner
  ? html`<form method="post" action="/admin/battery/tasks" class="card"><p><strong>新增或修改任務類型</strong>（同一個代碼會覆蓋原設定）</p>
<label for="task-app">App</label><select id="task-app" name="app_id">${apps.map((a) => html`<option value="${a.app_id}">${a.name}</option>`)}</select>
<label for="task-name">任務代碼（英文小寫，例如 transcribe；完整代碼為「App.任務」）</label><input id="task-name" name="name" pattern="[a-z][a-z0-9_-]{1,31}" required>
<label for="task-label">顯示名稱（會員看得到）</label><input id="task-label" name="label" maxlength="60" required>
<label for="task-cost">每單位消耗幾顆</label><input id="task-cost" name="unit_cost" type="number" min="1" max="100000" step="1" required>
<label for="task-max">單次最多幾單位</label><input id="task-max" name="max_units" type="number" min="1" max="100000" step="1" required>
<label for="task-timeout">逾時秒數（留空用預設）</label><input id="task-timeout" name="timeout" type="number" min="10" max="3600" step="1">
<label><input type="checkbox" name="enabled" value="1" checked> 啟用</label>
<button type="submit">儲存任務類型</button></form>`
  : ''}`,
    ),
  );
}

adminApp.get('/battery', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return batteryPage(c, actor);
});

adminApp.post('/battery/policy', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  const form = await readForm(c);
  const now = Date.now();
  const ok = await setPolicy(c.env.DB_BATTERY, { monthlyAllowance: Number(form.allowance), defaultTimeoutMs: Number(form.timeout) * 1000, actorUserId: actor.userId }, now);
  if (!ok) return batteryPage(c, actor, '請輸入 0～1000000 的額度與 10～3600 秒的逾時。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.battery_policy_updated', targetType: 'battery_policy', targetId: 'monthly', result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return batteryPage(c, actor, '已更新每月額度。');
});

adminApp.post('/battery/tasks', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  const form = await readForm(c);
  const appId = form.app_id ?? '';
  if (!appRegistry.has(appId) || appId === WEB_APP_ID) return batteryPage(c, actor, '請選擇 App。');
  const timeout = (form.timeout ?? '').trim();
  const input = {
    taskType: `${appId}.${(form.name ?? '').trim()}`,
    appId,
    label: form.label ?? '',
    unitCost: Number(form.unit_cost),
    maxUnits: Number(form.max_units),
    timeoutMs: timeout === '' ? null : Number(timeout) * 1000,
    enabled: form.enabled === '1',
  };
  const now = Date.now();
  if (!(await upsertTaskType(c.env.DB_BATTERY, input, actor.userId, now))) return batteryPage(c, actor, '任務設定不正確，請檢查每個欄位的範圍。');
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.battery_task_updated', targetType: 'battery_task', targetId: input.taskType, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return batteryPage(c, actor, `已儲存 ${input.taskType}。`);
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
  const attachments = await listAttachments(db, t.ticket_id);
  const replies = await listReplies(db, t.ticket_id);
  const canEmail = mailSettings(c.env, new URL(c.req.url).origin) !== null;
  const recipient = await replyRecipient(db, t);
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
${attachments.map(
  (a) => html`<p><strong>附件：</strong><a href="/admin/tickets/${t.ticket_id}/attachments/${a.attachment_id}">下載 ${ATTACHMENT_EXTENSIONS[a.content_type].toUpperCase()}（${Math.max(1, Math.round(a.size_bytes / 1024))} KB）</a><br><span class="muted">使用者上傳的檔案，請勿在登入中的電腦上直接開啟可疑檔案。</span></p>`,
)}
</div>
${replies.length > 0
  ? html`<h2>回覆紀錄</h2>${replies.map(
      (r) => html`<div class="card"><p class="muted">${formatTime(r.created_at)}｜${r.delivery === 'sent' ? '已寄出' : html`<span class="danger">寄送失敗（${r.error_code ?? '未知'}）</span>`}</p><p style="white-space:pre-wrap">${r.body}</p></div>`,
    )}`
  : ''}
<h2>以 Email 回覆</h2>
${!canEmail
  ? html`<p class="muted">系統 Email 尚未啟用（需業主完成 Email Service 設定），請暫時用客服信箱直接回覆。</p>`
  : !recipient
    ? html`<p class="muted">找不到可回覆的 Email（會員的登入方式沒有提供 Email）。</p>`
    : html`<form method="post" action="/admin/tickets/${t.ticket_id}/reply" class="card">
<p class="muted">寄給：${recipient}（信中會附上原始訊息，回信會寄到客服信箱）</p>
<label for="reply">回覆內容（最多 2000 字）</label><textarea id="reply" name="reply" maxlength="2000" rows="6" required></textarea>
${t.status === 'open' ? html`<label><input type="checkbox" name="close" value="yes" style="width:auto" checked> 寄出後結案</label>` : ''}
<button type="submit">寄出回覆</button>
</form>`}
<h2>狀態與內部備註</h2>
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

/** Streams a ticket attachment as a download; never rendered inline (S-WEB-02). */
adminApp.get('/tickets/:id/attachments/:attachmentId', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const db = c.env.DB_IDENTITY;
  const attachment = await getAttachment(db, c.req.param('id'), c.req.param('attachmentId'));
  const object = attachment ? await c.env.SUPPORT_FILES?.get(attachment.object_key) : null;
  if (!attachment || !object) return c.html(adminPage(c, '找不到附件', html`<h1>找不到附件</h1>`), 404);
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.ticket_attachment_viewed', targetType: 'ticket', targetId: attachment.ticket_id, result: 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
  const filename = `ticket-${attachment.ticket_id.slice(-8)}.${ATTACHMENT_EXTENSIONS[attachment.content_type]}`;
  return new Response(object.body, {
    headers: {
      'content-type': attachment.content_type,
      'content-length': String(attachment.size_bytes),
      'content-disposition': `attachment; filename="${filename}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
});

/** POST /admin/tickets/:id/reply — emails the reply to the sender and keeps it with the ticket (S-NTF-02). */
adminApp.post('/tickets/:id/reply', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const db = c.env.DB_IDENTITY;
  const ticketId = c.req.param('id');
  const ticket = await getTicket(db, ticketId);
  if (!ticket) return ticketPage(c, actor, ticketId, '找不到客服單。');
  const mail = mailSettings(c.env, new URL(c.req.url).origin);
  if (!mail) return ticketPage(c, actor, ticketId, '系統 Email 尚未啟用。');
  const form = await readForm(c);
  const now = Date.now();
  const result = await replyToTicket(db, mail, actor, ticket, form.reply ?? '', now);
  if (!result.ok) return ticketPage(c, actor, ticketId, result.reason === 'invalid' ? '回覆內容需為 1～2000 字。' : '找不到可回覆的 Email。');
  if (result.reply.delivery === 'failed') return ticketPage(c, actor, ticketId, `寄送失敗（${result.reply.error_code ?? '未知'}），回覆已保存，請稍後再試或改用客服信箱。`);
  if (form.close === 'yes' && ticket.status === 'open') await setTicketStatus(db, actor, ticketId, 'closed', null, now);
  return ticketPage(c, actor, ticketId, form.close === 'yes' && ticket.status === 'open' ? '已寄出回覆並結案。' : '已寄出回覆。');
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
  return html`<form method="post" action="/admin/apps/${app.app_id}/status" class="card">
<p><strong>${app.name}</strong> <code>${app.app_id}</code>（${own ? '後台登記' : 'config/apps.json'}）<br>預設：${app.status}｜目前：<strong>${o?.status ?? app.status}</strong>${o?.reason ? html`（${o.reason}）` : ''}</p>
<p><a href="/admin/apps/${app.app_id}/handoff">給開發 AI 的串接指令</a>${own ? html`&emsp;<a href="/admin/apps/${app.app_id}/edit">編輯登記資料</a>` : ''}</p>
<label>新狀態</label><select name="status"><option value="default">使用預設</option><option value="active">active</option><option value="paused">paused</option><option value="killed">killed</option></select>
<label>原因（最多 200 字）</label><input name="reason" maxlength="200">
<button type="submit">更新</button></form>`;
})}`,
    ),
  );
}

function appForm(c: WebContext, mode: 'create' | 'update', values: AppForm, message?: string): Response | Promise<Response> {
  const create = mode === 'create';
  return c.html(
    adminPage(
      c,
      create ? '新增 App' : '編輯 App',
      html`<h1>${create ? '新增 App' : `編輯 ${values.app_id ?? ''}`}</h1>
${message ? html`<div class="banner danger">${message}</div>` : ''}
<p class="muted">三個平台（iOS、Android、網頁）預設都走 Starry 登入中繼：帳號中心的 Apple Services ID 與 Google 網頁用戶端會自動加進這款 App，不必到 Apple、Google 後台為它做任何設定。只有日後改用原生登入時，才需要填最下面的進階欄位。</p>
<form method="post" action="${create ? '/admin/apps/new' : `/admin/apps/${values.app_id ?? ''}/edit`}" class="card">
<label for="app_id">app_id（小寫英文、數字、連字號，2～32 字，建立後不能改）</label><input id="app_id" name="app_id" value="${values.app_id ?? ''}" pattern="[a-z][a-z0-9-]{1,31}" required ${create ? '' : 'readonly'}>
<label for="name">名稱</label><input id="name" name="name" value="${values.name ?? ''}" maxlength="80" required>
<label for="ios_bundle_id">iOS Bundle ID（沒有就留空）</label><input id="ios_bundle_id" name="ios_bundle_id" value="${values.ios_bundle_id ?? ''}" placeholder="phd.starry.example">
<label for="android_package">Android package（沒有就留空）</label><input id="android_package" name="android_package" value="${values.android_package ?? ''}" placeholder="phd.starry.example">
<label for="scheme">App 深層連結 scheme（留空則用 app_id 去掉連字號）</label><input id="scheme" name="scheme" value="${values.scheme ?? ''}" placeholder="example">
<label for="web_origins">網頁版來源（每行一個，例如 https://example.starry.phd；沒有網頁版就留空）</label><textarea id="web_origins" name="web_origins" rows="3">${values.web_origins ?? ''}</textarea>
<label for="return_urls">額外的深層連結回傳網址（每行一個；留空則自動產生 scheme://auth/apple 與 scheme://auth/google）</label><textarea id="return_urls" name="return_urls" rows="2">${values.return_urls ?? ''}</textarea>
<label for="min_version">最低版本（例如 1.0.0，預設 0.0.0）</label><input id="min_version" name="min_version" value="${values.min_version ?? ''}" pattern="\d+\.\d+\.\d+">
<label for="extra_apple_audiences">額外的 Apple 登入對象（每行一個，進階，通常留空）</label><textarea id="extra_apple_audiences" name="extra_apple_audiences" rows="2">${values.extra_apple_audiences ?? ''}</textarea>
<label for="extra_google_audiences">額外的 Google 用戶端 ID（每行一個，例如 iOS 用戶端，進階，通常留空）</label><textarea id="extra_google_audiences" name="extra_google_audiences" rows="2">${values.extra_google_audiences ?? ''}</textarea>
${create ? html`<label><input type="checkbox" name="battery" value="1" checked> 同時開通 Starry Battery（建立預設任務 AI 任務並產生後端服務金鑰）</label>` : ''}
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
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  const form = (await readForm(c)) as AppForm;
  const built = definitionFromForm(form);
  if (!built.ok) return appForm(c, 'create', form, built.error);
  const result = await saveRegisteredApp(c.env.DB_IDENTITY, actor, built.app, 'create', Date.now());
  if (result === 'reserved' || result === 'exists') return appForm(c, 'create', form, '這個 app_id 已被使用，請換一個。');
  if (form.battery === '1') return enableBatteryAndShow(c, actor, built.app.app_id, '已建立並開通 Battery，30 秒內生效。');
  return c.redirect(`/admin/apps/${built.app.app_id}/handoff?created=1`, 303);
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
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
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
  return c.html(
    adminPage(
      c,
      '串接指令',
      html`<h1>${app.name} 的串接指令</h1>
${notice ? html`<div class="banner">${notice}</div>` : ''}
${serviceKey ? html`<div class="card"><p><strong>Battery 服務金鑰（只顯示這一次，請現在複製保存）</strong></p>
<textarea readonly rows="2" style="width:100%;font-family:monospace" onclick="this.select()">${serviceKey}</textarea>
<p class="muted">只放進這款 App 後端的 Secret（名稱 STARRY_BATTERY_KEY）。不要貼進 App、Git 或公開的地方；遺失或外洩就按下面的「重新產生」，舊金鑰會立刻失效。</p></div>` : ''}
<p class="muted">下面整段複製後貼給負責開發這款 App 的 AI。內容只有已登記的公開資料，沒有任何秘密；服務金鑰請另外提供給它。</p>
<textarea readonly rows="30" style="width:100%;font-family:monospace" onclick="this.select()">${text}</textarea>
${role === 'owner' ? html`<form method="post" action="/admin/apps/${app.app_id}/battery-key" class="card"><button type="submit">${hasKey ? '重新產生 Battery 服務金鑰' : '開通 Battery'}</button></form>` : ''}
<p><a href="/admin/apps">回到 App 清單</a></p>`,
    ),
  );
}

async function enableBatteryAndShow(c: WebContext, actor: StaffActor, appId: string, notice: string): Promise<Response> {
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

adminApp.post('/apps/:id/battery-key', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const reauth = await needsReauth(c);
  if (reauth) return reauth;
  return enableBatteryAndShow(c, actor, c.req.param('id'), 'Battery 已開通，服務金鑰已更新（舊金鑰立即失效）。');
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

// ---- API documentation (S-PLT-04): Owner/Admin only ----

type ApiDocument = { paths?: Record<string, Record<string, { summary?: string; tags?: string[]; security?: unknown[] } | undefined> | undefined> };
let apiDocument: (() => unknown) | null = null;

/** Set by app.ts once every route is registered, so the page shows the generated OpenAPI document. */
export function setApiDocument(provider: () => unknown): void {
  apiDocument = provider;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

adminApp.get('/api', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const doc = (apiDocument?.() ?? {}) as ApiDocument;
  const rows = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((m) => item?.[m]).map((m) => ({ path, method: m.toUpperCase(), op: item?.[m] })),
  );
  return c.html(
    adminPage(
      c,
      'API 文件',
      html`<h1>API 文件</h1>
<p>由程式碼自動產生的 OpenAPI 3.1（<a href="/admin/api/openapi.json">下載 JSON</a>）。新 App 串接請看 <a href="https://github.com/starry-phd/id/blob/main/docs/integration-guide.md">串接說明</a>；App 端用 openapi-typescript 產生型別、openapi-fetch 呼叫。</p>
<table><thead><tr><th>方法</th><th>路徑</th><th>說明</th></tr></thead><tbody>
${rows.map((r) => html`<tr><td><code>${r.method}</code></td><td><code>${r.path}</code>${r.op?.security?.length ? ' 🔒' : ''}</td><td>${r.op?.summary ?? ''}<br><span class="muted">${(r.op?.tags ?? []).join('、')}</span></td></tr>`)}
</tbody></table>`,
    ),
  );
});

adminApp.get('/api/openapi.json', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  return c.json(apiDocument?.() ?? {});
});
