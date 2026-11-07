import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { definitionFromForm, listRegisteredAppIds, saveRegisteredApp, type AppForm } from '../apps/dynamic';
import { cleanupBacklog } from '../identity/cleanup-jobs';
import { getNotices, saveNotices } from '../lib/notices';
import { readHeartbeats } from '../lib/heartbeat';
import { buildHandoff } from '../apps/handoff';
import { adjustQuantum, listQuantum, listQuantumProducts, removeQuantumProduct, saveQuantumProduct } from '../battery/quantum';
import { appRegistry, getApp, type AppEntry, type AppStatus } from '../apps/registry';
import { listAppStatusOverrides, setAppStatusOverride } from '../apps/status';
import { background } from '../auth/routes';
import { adjustAllowance, appMonthUsage, setAppCap, MAX_RESERVATION_UNITS, enableAppBattery, getBalance, hasAppBatteryKey, getPolicy, setPolicy, staffLedger } from '../battery/battery';
import type { AppBindings } from '../env';
import { listAudit } from '../identity/audit-query';
import { WEB_APP_ID } from '../identity/web-sessions';
import { cleanupAfterDeletion } from '../identity/erase';
import { deleteMemberNow } from '../identity/lifecycle';
import { findMemberSummary, searchMembers } from '../identity/member-search';
import { hasRole, restoreMember, revokeAllSessions, roleOf, setStaffRole, suspendMember, type Role, type StaffActor, type StatusChangeResult } from '../identity/roles';
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
 * Battery policy.
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

const nav = html`<p><a href="/admin/members">會員</a>&emsp;<a href="/admin/tickets">客服單</a>&emsp;<a href="/admin/battery">Battery</a>&emsp;<a href="/admin/apps">App</a>&emsp;<a href="/admin/audit">稽核紀錄</a></p>`;

function adminPage(c: WebContext, title: string, body: Html, scripts?: Html): Html {
  return page(c, title, html`${nav}${body}`, { admin: true, ...(scripts ? { scripts } : {}) });
}

adminApp.get('/', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const since = now - 24 * 60 * 60 * 1000;
  const [members, open, today, active] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM users'),
    db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'"),
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?').bind(since),
    db.prepare('SELECT app_id, COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_used_at >= ? GROUP BY app_id ORDER BY n DESC LIMIT 20').bind(since),
  ]);
  const count = (r: typeof members) => Number((r?.results[0] as { n?: number } | undefined)?.n ?? 0);
  const [beats, backlog, usage] = await Promise.all([
    readHeartbeats(db),
    cleanupBacklog(db),
    c.env.DB_BATTERY.prepare('SELECT app_id, SUM(amount) AS used, COUNT(DISTINCT user_id) AS members FROM battery_ledger WHERE kind = ? AND created_at >= ? GROUP BY app_id ORDER BY used DESC LIMIT 20')
      .bind('usage', since)
      .all<{ app_id: string; used: number; members: number }>(),
  ]);
  const activeRows = (active?.results ?? []) as { app_id: string; n: number }[];
  const stale = (b: { job: string; last_success_at: number | null }) => b.last_success_at === null || now - b.last_success_at > (b.job === 'minutely' ? 10 * 60 * 1000 : 36 * 60 * 60 * 1000);
  const problems = beats.filter(stale).length + backlog.abandoned;
  return c.html(
    adminPage(
      c,
      'Admin Lite',
      html`<h1>Admin Lite</h1><p class="muted">你的角色：${ROLE_LABELS[actor.role]} ｜ <a href="/admin/notices">公告與維護模式</a></p>
${problems > 0 ? html`<div class="banner danger">有 ${problems} 項系統狀況需要注意，請看下方「系統狀態」。</div>` : ''}
<div class="card"><p>會員總數：<strong>${count(members)}</strong>（近 24 小時新增 <strong>${count(today)}</strong>）</p><p>未結客服單：<strong>${count(open)}</strong></p></div>
<h2>近 24 小時各 App</h2>
<div class="card"><table><thead><tr><th>App</th><th>活躍會員</th><th>Battery 用量</th></tr></thead><tbody>
${activeRows.map((r) => {
  const u = usage.results.find((x) => x.app_id === r.app_id);
  return html`<tr><td><code>${r.app_id}</code></td><td>${r.n}</td><td>${u ? `${u.used}（${u.members} 人）` : '0'}</td></tr>`;
})}
</tbody></table>${activeRows.length === 0 ? html`<p class="muted">近 24 小時沒有活動。</p>` : ''}</div>
<h2>系統狀態</h2>
<div class="card"><table><thead><tr><th>排程</th><th>最近成功</th><th>狀況</th></tr></thead><tbody>
${beats.map((b) => html`<tr><td>${b.job === 'minutely' ? '每分鐘' : '每日'}</td><td>${b.last_success_at ? formatTime(b.last_success_at) : '—'}</td><td>${stale(b) ? html`<strong>逾時未成功</strong>${b.last_error ? html`<br><span class="muted">${b.last_error}</span>` : ''}` : '正常'}</td></tr>`)}
</tbody></table>
<p>刪除帳號後的清除作業：等待重試 <strong>${backlog.waiting}</strong>，已放棄 <strong>${backlog.abandoned}</strong>${backlog.abandoned > 0 ? '（需要人工處理）' : ''}</p></div>`,
    ),
  );
});

const COPY_SCRIPT = (nonce: string) => html`<script nonce="${nonce}">
document.querySelectorAll('[data-copy-text]').forEach(function (button) {
  button.addEventListener('click', function () {
    var text = button.getAttribute('data-copy-text');
    var label = button.textContent;
    var done = function () { button.textContent = '已複製'; setTimeout(function () { button.textContent = label; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
  });
});
</script>`;

const dayStart = (value: string | undefined): number | undefined => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isNaN(ms) ? undefined : ms;
};
const wholeNumber = (value: string | undefined): number | undefined => (value && /^\d{1,9}$/.test(value) ? Number(value) : undefined);
const PROVIDER_LABELS: Record<string, string> = { apple: 'Apple', google: 'Google' };
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

adminApp.get('/members', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const q = c.req.query('q') ?? '';
  const status = c.req.query('status') ?? '';
  const provider = c.req.query('provider') ?? '';
  const countryInput = c.req.query('country') ?? '';
  const country = COUNTRY_CODE.test(countryInput) ? countryInput.toUpperCase() : '';
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const batteryMin = c.req.query('battery_min') ?? '';
  const batteryMax = c.req.query('battery_max') ?? '';
  const staffOnly = c.req.query('staff') === '1';
  const toStart = dayStart(to);
  const filters = {
    query: q,
    status: status || undefined,
    provider: provider || undefined,
    country: country || undefined,
    from: dayStart(from),
    to: toStart === undefined ? undefined : toStart + 24 * 60 * 60 * 1000,
    staffOnly,
    batteryMin: wholeNumber(batteryMin),
    batteryMax: wholeNumber(batteryMax),
  };
  const now = Date.now();
  const result = await searchMembers(c.env.DB_IDENTITY, c.env.DB_BATTERY, c.env.OWNER_USER_IDS, { ...filters, cursor: c.req.query('cursor') }, now);
  const params = { q, status, provider, country, from, to, battery_min: batteryMin, battery_max: batteryMax, ...(staffOnly ? { staff: '1' } : {}) };
  const next = result.nextCursor ? `/admin/members?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '')), cursor: result.nextCursor }).toString()}` : null;
  const option = (value: string, label: string, current: string) => html`<option value="${value}"${value === current ? raw(' selected') : ''}>${label}</option>`;
  return c.html(
    adminPage(
      c,
      '會員',
      html`<h1>會員</h1>
<form method="get" action="/admin/members" class="card">
<label for="q">關鍵字（會員編號、姓名、Email，輸入一部分即可）</label><input id="q" name="q" value="${q}">
<label for="status">狀態</label><select id="status" name="status">${option('', '全部', status)}${option('active', '正常', status)}${option('suspended', '停權', status)}${option('pending_deletion', '刪除中（舊資料）', status)}</select>
<label for="provider">登入方式</label><select id="provider" name="provider">${option('', '全部', provider)}${option('apple', 'Apple', provider)}${option('google', 'Google', provider)}</select>
<label for="country">註冊國家（兩碼，例如 TW、JP）</label><input id="country" name="country" maxlength="2" value="${country}">
<label for="from">加入日期（起）</label><input id="from" name="from" type="date" value="${from}">
<label for="to">加入日期（迄）</label><input id="to" name="to" type="date" value="${to}">
<label for="battery_min">本月 Battery 剩餘（最少）</label><input id="battery_min" name="battery_min" inputmode="numeric" value="${batteryMin}">
<label for="battery_max">本月 Battery 剩餘（最多，填 0 可找出用完的人）</label><input id="battery_max" name="battery_max" inputmode="numeric" value="${batteryMax}">
<label><input type="checkbox" name="staff" value="1"${staffOnly ? raw(' checked') : ''}> 只看管理人員</label>
<button type="submit">查詢</button>&emsp;<a href="/admin/members">清除條件</a>
</form>
<table><thead><tr><th>會員</th><th>Email／登入</th><th>狀態</th><th>Battery 剩餘</th><th>加入／最近登入</th></tr></thead><tbody>
${result.members.map(
  (m) => html`<tr><td><a href="/admin/members/${m.user_id}">${m.display_name ?? '（未命名）'}</a><br><code>${m.member_no ?? '（發放中）'}</code>${m.role ? html`<br>${ROLE_LABELS[m.role]}` : ''}</td>
<td>${m.contact_email ?? m.emails.find((e) => e !== null) ?? '（無 Email）'}<br><span class="muted">${m.providers.map((p) => PROVIDER_LABELS[p] ?? p).join('、')}${m.country ? html`｜${m.country}` : ''}</span></td>
<td>${STATUS_LABELS[m.status] ?? m.status}</td>
<td>${m.battery ? html`<strong>${m.battery.remaining}</strong> / ${m.battery.allowance}` : '—'}</td>
<td>${formatTime(m.created_at)}<br><span class="muted">${m.last_login_at ? formatTime(m.last_login_at) : '—'}</span></td></tr>`,
)}
</tbody></table>
${result.members.length === 0 ? html`<p class="muted">沒有符合的會員。</p>` : ''}
${next ? html`<p class="pager"><a href="${next}">下一頁</a></p>` : ''}`,
    ),
  );
});

async function memberPage(c: WebContext, actor: StaffActor, userId: string, message?: string): Promise<Response> {
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const m = await findMemberSummary(db, c.env.DB_BATTERY, c.env.OWNER_USER_IDS, userId, now);
  if (!m) return c.html(adminPage(c, '找不到會員', html`<h1>找不到會員</h1>`), 404);
  // Names and emails are shown in full, so every time staff open a member is recorded.
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.member_viewed', targetType: 'user', targetId: m.user_id, result: 'success', requestId: actor.requestId, retention: 'general' }, now).run();
  const canModerate = hasRole(actor.role, 'admin') && m.role !== 'owner' && m.user_id !== actor.userId;
  const canAdjust = hasRole(actor.role, 'admin') && m.user_id !== actor.userId;
  const [balance, quantum, ledger, sessions, tickets] = await Promise.all([
    getBalance(c.env.DB_BATTERY, m.user_id, now),
    listQuantum(c.env.DB_BATTERY, m.user_id),
    staffLedger(c.env.DB_BATTERY, m.user_id, 10),
    db
      .prepare('SELECT app_id, device_label, created_at, last_used_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC LIMIT 20')
      .bind(m.user_id, now)
      .all<{ app_id: string; device_label: string | null; created_at: number; last_used_at: number }>(),
    db
      .prepare('SELECT ticket_id, created_at, category, status FROM support_tickets WHERE user_id = ? ORDER BY ticket_id DESC LIMIT 10')
      .bind(m.user_id)
      .all<{ ticket_id: string; created_at: number; category: string; status: string }>(),
  ]);
  const copy = (text: string, label: string) => html`<button type="button" data-copy-text="${text}">${label}</button>`;
  const email = m.contact_email ?? m.emails.find((e) => e !== null) ?? null;
  return c.html(
    adminPage(
      c,
      '會員資料',
      html`<h1>${m.display_name ?? '（未命名）'}</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<div class="card">
<p><strong>會員編號：</strong><code>${m.member_no ?? '（發放中）'}</code> ${m.member_no ? copy(m.member_no, '複製編號') : ''}<br>
<strong>姓名：</strong>${m.display_name ?? '（未設定）'}<br>
<strong>聯絡 Email：</strong>${m.contact_email ?? '（未設定）'} ${m.contact_email ? copy(m.contact_email, '複製') : ''}<br>
<strong>登入方式：</strong>${m.providers.map((p, i) => html`${PROVIDER_LABELS[p] ?? p}（${m.emails[i] ?? '無 Email'}）&ensp;`)}${email ? copy(email, '複製 Email') : ''}<br>
<strong>狀態：</strong>${STATUS_LABELS[m.status] ?? m.status}${m.status_reason ? html`（${m.status_reason}）` : ''}<br>
<strong>角色：</strong>${m.role ? ROLE_LABELS[m.role] : '一般會員'}<br>
<strong>註冊國家：</strong>${m.country ?? '（未記錄）'}<br>
<strong>加入：</strong>${formatTime(m.created_at)}｜<strong>最近登入：</strong>${m.last_login_at ? formatTime(m.last_login_at) : '—'}</p>
<details><summary>內部 ID（UUID）</summary><p><code>${m.user_id}</code> ${copy(m.user_id, '複製')}</p></details>
<p><a href="/admin/audit?member=${m.user_id}">查看此會員的稽核紀錄</a></p>
</div>
<h2>登入中的裝置</h2>
<div class="card">
${sessions.results.length > 0
  ? html`<table><thead><tr><th>App</th><th>裝置</th><th>登入</th><th>最近使用</th></tr></thead><tbody>
${sessions.results.map((s) => html`<tr><td>${s.app_id}</td><td>${s.device_label ?? '—'}</td><td>${formatTime(s.created_at)}</td><td>${formatTime(s.last_used_at)}</td></tr>`)}
</tbody></table>`
  : html`<p class="muted">目前沒有登入中的裝置。</p>`}
${canModerate && sessions.results.length > 0
  ? html`<form method="post" action="/admin/members/${m.user_id}/signout"><button class="danger" type="submit">強制登出所有裝置</button></form>`
  : ''}
</div>
<h2>客服單</h2>
<div class="card">
${tickets.results.length > 0
  ? html`<table><thead><tr><th>時間</th><th>類別</th><th>狀態</th></tr></thead><tbody>
${tickets.results.map((t) => html`<tr><td><a href="/admin/tickets/${t.ticket_id}">${formatTime(t.created_at)}</a></td><td>${CATEGORY_LABELS[t.category as keyof typeof CATEGORY_LABELS] ?? t.category}</td><td>${t.status === 'open' ? '未結' : '已結'}</td></tr>`)}
</tbody></table>`
  : html`<p class="muted">沒有客服單。</p>`}
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
<h2>量子電池（各 App 內購）</h2>
${quantum.length > 0
  ? html`<table><thead><tr><th>App</th><th>餘額</th><th>使用中</th></tr></thead><tbody>${quantum.map((q) => html`<tr><td><code>${q.app_id}</code></td><td>${q.balance}</td><td>${q.reserved}</td></tr>`)}</tbody></table>`
  : html`<p class="muted">沒有量子電池。</p>`}
${canAdjust
  ? html`<form method="post" action="/admin/members/${m.user_id}/quantum"><label for="q-app">App 代碼</label><input id="q-app" name="app_id" maxlength="64" required>
<label for="q-delta">調整顆數（正數增加、負數減少，不能低於 0）</label><input id="q-delta" name="delta" type="number" step="1" required>
<label for="q-reason">原因（必填，最多 200 字，會員看不到）</label><input id="q-reason" name="reason" maxlength="200" required><button type="submit">調整量子電池</button></form>`
  : ''}
</div>
${canModerate && m.status === 'active'
  ? html`<h2>停權</h2><form method="post" action="/admin/members/${m.user_id}/suspend" class="card"><label for="reason">原因（必填，最多 200 字，會員看不到）</label><input id="reason" name="reason" maxlength="200" required><button class="danger" type="submit">停權</button></form>`
  : ''}
${canModerate && m.status === 'suspended'
  ? html`<h2>復權</h2><form method="post" action="/admin/members/${m.user_id}/restore" class="card"><p>復權後會員需要重新登入。</p><button type="submit">復權</button></form>`
  : ''}
${actor.role === 'owner' && m.role !== 'owner' && m.user_id !== actor.userId
  ? html`<h2>永久刪除會員</h2><form method="post" action="/admin/members/${m.user_id}/delete" class="card"><p>立即永久刪除這位會員的所有資料，無法復原；會員編號不會再發給任何人。</p>
<label for="confirm">請輸入大寫英文 DELETE 以確認</label><input id="confirm" name="confirm" autocomplete="off" required><button class="danger" type="submit">永久刪除</button></form>`
  : ''}
${actor.role === 'owner' && m.role !== 'owner' && m.user_id !== actor.userId
  ? html`<h2>管理角色</h2><form method="post" action="/admin/members/${m.user_id}/role" class="card"><label for="role">角色</label>
<select id="role" name="role"><option value="none">一般會員</option><option value="support">Support</option><option value="admin">Admin</option></select><button type="submit">更新角色</button></form>`
  : ''}`,
      COPY_SCRIPT(c.get('cspNonce')),
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
  const reason = ((await readForm(c)).reason ?? '').trim();
  if (reason.length < 1 || reason.length > 200) return memberPage(c, actor, c.req.param('id'), '請填寫 1～200 字的停權原因。');
  const result = await suspendMember(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, c.req.param('id'), reason, Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.post('/members/:id/signout', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const result = await revokeAllSessions(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, c.req.param('id'), Date.now());
  return memberPage(c, actor, c.req.param('id'), result === 'ok' ? '已強制登出此會員的所有裝置。' : RESULT_TEXT[result]);
});

adminApp.post('/members/:id/delete', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const userId = c.req.param('id');
  const m = await findMemberSummary(c.env.DB_IDENTITY, null, c.env.OWNER_USER_IDS, userId, Date.now());
  if (!m) return memberPage(c, actor, userId);
  if (m.user_id === actor.userId || m.role === 'owner') return memberPage(c, actor, userId, RESULT_TEXT.not_allowed);
  if (((await readForm(c)).confirm ?? '').trim() !== 'DELETE') return memberPage(c, actor, userId, '請輸入大寫英文 DELETE 才能刪除。');
  const now = Date.now();
  const result = await deleteMemberNow(c.env.DB_IDENTITY, { userId: m.user_id, appId: null, requestId: actor.requestId, staffId: actor.userId }, now);
  if (!result.ok) return memberPage(c, actor, userId);
  await cleanupAfterDeletion(c.env, m.user_id, result.avatarKey, now);
  return c.html(adminPage(c, '會員已刪除', html`<h1>會員已刪除</h1><div class="banner">已永久刪除會員 <code>${result.memberNo ?? ''}</code>，編號不會再發給任何人。</div><p><a href="/admin/members">回到會員列表</a></p>`));
});

adminApp.post('/members/:id/restore', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const result = await restoreMember(c.env.DB_IDENTITY, actor, c.req.param('id'), Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.post('/members/:id/role', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const value = (await readForm(c)).role;
  const role = value === 'admin' || value === 'support' ? value : value === 'none' ? null : undefined;
  if (role === undefined) return memberPage(c, actor, c.req.param('id'), '請選擇角色。');
  const result = await setStaffRole(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, c.req.param('id'), role, Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.post('/members/:id/battery', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
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
  const actor = await staff(c, 'admin');
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

adminApp.post('/members/:id/quantum', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
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
