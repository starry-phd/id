import { html, raw } from 'hono/html';
import { cleanupBacklog } from '../identity/cleanup-jobs';
import { readHeartbeats } from '../lib/heartbeat';
import { listQuantum } from '../battery/quantum';
import { listGrants } from '../billing/grants';
import { appRegistry, getApp } from '../apps/registry';
import { listAppStages, listAppStatusOverrides, STAGE_LABELS } from '../apps/status';
import { trafficLights, type Light } from './traffic-lights';
import { background } from '../auth/routes';
import { adjustAllowance, getBalance, staffLedger } from '../battery/battery';
import { WEB_APP_ID } from '../identity/web-sessions';
import { cleanupAfterDeletion } from '../identity/erase';
import { deleteMemberNow } from '../identity/lifecycle';
import { findMemberSummary, searchMembers } from '../identity/member-search';
import { hasRole, listAppStaff, restoreMember, revokeAllSessions, setAppStaff, setStaffRole, suspendMember, type StaffActor } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { bulkPush } from '../notify/bulk';
import { mailSettings, notifyStaffChange } from '../notify/email';
import { CATEGORY_LABELS } from '../support/tickets';
import { formatTime, readForm, type WebContext } from './layout';
import { changeMemberNo } from '../identity/member-number';
import { RESULT_TEXT, ROLE_LABELS, STATUS_LABELS, adminApp, adminPage, staff, requireStepUp, supportAccess } from './admin-lib';
import { scopedMemberPage, scopedMembersPage } from './admin-scoped';

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
  const [beats, backlog, usage, seen, subs, stages, overrides, oldestOpen] = await Promise.all([
    readHeartbeats(db),
    cleanupBacklog(db),
    c.env.DB_BATTERY.prepare('SELECT app_id, SUM(amount) AS used, COUNT(DISTINCT user_id) AS members FROM battery_ledger WHERE kind = ? AND created_at >= ? GROUP BY app_id ORDER BY used DESC LIMIT 20')
      .bind('usage', since)
      .all<{ app_id: string; used: number; members: number }>(),
    db.prepare('SELECT app_id, COUNT(*) AS total, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS week, SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS month FROM member_apps GROUP BY app_id')
      .bind(now - 7 * 86400_000, now - 30 * 86400_000)
      .all<{ app_id: string; total: number; week: number; month: number }>(),
    c.env.DB_BILLING.prepare("SELECT app_id, COUNT(*) AS n FROM entitlements WHERE active = 1 AND (environment IS NULL OR environment != 'SANDBOX') GROUP BY app_id").all<{ app_id: string; n: number }>(),
    listAppStages(db),
    listAppStatusOverrides(db),
    db.prepare("SELECT MIN(created_at) AS oldest FROM support_tickets WHERE status = 'open'").first<{ oldest: number | null }>(),
  ]);
  const activeRows = (active?.results ?? []) as { app_id: string; n: number }[];
  const stale = (b: { job: string; last_success_at: number | null }) => b.last_success_at === null || now - b.last_success_at > (b.job === 'minutely' ? 10 * 60 * 1000 : 36 * 60 * 60 * 1000);
  const problems = beats.filter(stale).length + backlog.abandoned;
  const lights = trafficLights({
    now,
    jobsStale: beats.filter(stale).length,
    cleanupWaiting: backlog.waiting,
    cleanupAbandoned: backlog.abandoned,
    openTickets: count(open),
    oldestOpenTicketAt: oldestOpen?.oldest ?? null,
    appStatuses: [...appRegistry.values()].map((a) => overrides.get(a.app_id)?.status ?? a.status),
  });
  return c.html(
    adminPage(
      c,
      'Admin Lite',
      html`<h1>首頁</h1><p class="muted">你的角色：<span class="badge">${ROLE_LABELS[actor.role]}</span></p>
<div class="stats">${lights.map((l: Light) => html`<div class="stat${l.color === 'red' ? ' warn' : ''}"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:middle;background:${l.color === 'green' ? '#2e9e4f' : l.color === 'yellow' ? '#e0a800' : '#d32f2f'}"></span> <strong>${l.label}</strong><br><span class="muted">${l.text}</span></div>`)}</div>
${problems > 0 ? html`<div class="banner danger">有 ${problems} 項系統狀況需要注意，請看下方「系統狀態」。</div>` : ''}
<div class="stats">
<a class="stat" href="/admin/members" style="text-decoration:none;color:inherit"><b>${count(members)}</b><span>會員總數</span></a>
<div class="stat"><b>${count(today)}</b><span>近 24 小時新增</span></div>
<a class="stat${count(open) > 0 ? ' warn' : ''}" href="/admin/tickets?status=open" style="text-decoration:none;color:inherit"><b>${count(open)}</b><span>未結客服單</span></a>
</div>
<div class="grid">
<div class="card"><h2 style="margin-top:0">各 App 使用概況</h2><div class="tablewrap"><table><thead><tr><th>App</th><th>階段</th><th>用過的會員</th><th>7 天內</th><th>30 天內</th><th>有效權益</th></tr></thead><tbody>
${seen.results.map((r) => html`<tr><td><code>${r.app_id}</code></td><td>${STAGE_LABELS[stages.get(r.app_id) ?? 'dev']}</td><td>${r.total}</td><td>${r.week}</td><td>${r.month}</td><td>${subs.results.find((x) => x.app_id === r.app_id)?.n ?? 0}</td></tr>`)}
</tbody></table></div>${seen.results.length === 0 ? html`<p class="muted">還沒有會員使用任何 App。</p>` : ''}<p class="muted">有效權益＝目前生效的訂閱或買斷（不含測試環境）。</p></div>
<div class="card"><h2 style="margin-top:0">近 24 小時各 App</h2><div class="tablewrap"><table><thead><tr><th>App</th><th>活躍會員</th><th>Battery 用量</th></tr></thead><tbody>
${activeRows.map((r) => {
  const u = usage.results.find((x) => x.app_id === r.app_id);
  return html`<tr><td><code>${r.app_id}</code></td><td>${r.n}</td><td>${u ? `${u.used}（${u.members} 人）` : '0'}</td></tr>`;
})}
</tbody></table></div>${activeRows.length === 0 ? html`<p class="muted">近 24 小時沒有活動。</p>` : ''}</div>
<div class="card"><h2 style="margin-top:0">系統狀態 ${problems > 0 ? html`<span class="badge bad">需要注意</span>` : html`<span class="badge ok">正常</span>`}</h2>
<details${problems > 0 ? ' open' : ''}><summary>排程與清除作業明細</summary><div class="tablewrap"><table><thead><tr><th>排程</th><th>最近成功</th><th>狀況</th></tr></thead><tbody>
${beats.map((b) => html`<tr><td>${b.job === 'minutely' ? '每分鐘' : '每日'}</td><td>${b.last_success_at ? formatTime(b.last_success_at) : '—'}</td><td>${stale(b) ? html`<strong>逾時未成功</strong>${b.last_error ? html`<br><span class="muted">${b.last_error}</span>` : ''}` : '正常'}</td></tr>`)}
</tbody></table></div>
<p>刪除帳號後的清除作業：等待重試 <strong>${backlog.waiting}</strong>，已放棄 <strong>${backlog.abandoned}</strong>${backlog.abandoned > 0 ? '（需要人工處理）' : ''}</p></details></div>
</div>`,
    ),
  );
});

export const COPY_SCRIPT = (nonce: string) => html`<script nonce="${nonce}">
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
  const actor = await supportAccess(c);
  if (actor instanceof Response) return actor;
  if (actor.appScope) return scopedMembersPage(c, actor);
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
<label for="status">狀態</label><select id="status" name="status">${option('', '全部', status)}${option('active', '正常', status)}${option('suspended', '停權', status)}</select>
<label for="provider">登入方式</label><select id="provider" name="provider">${option('', '全部', provider)}${option('apple', 'Apple', provider)}${option('google', 'Google', provider)}</select>
<label for="country">註冊國家（兩碼，例如 TW、JP）</label><input id="country" name="country" maxlength="2" value="${country}">
<label for="from">加入日期（起）</label><input id="from" name="from" type="date" value="${from}">
<label for="to">加入日期（迄）</label><input id="to" name="to" type="date" value="${to}">
<label for="battery_min">本月 Battery 剩餘（最少）</label><input id="battery_min" name="battery_min" inputmode="numeric" value="${batteryMin}">
<label for="battery_max">本月 Battery 剩餘（最多，填 0 可找出用完的人）</label><input id="battery_max" name="battery_max" inputmode="numeric" value="${batteryMax}">
<label><input type="checkbox" name="staff" value="1"${staffOnly ? raw(' checked') : ''}> 只看管理人員</label>
<button type="submit">查詢</button>&emsp;<a href="/admin/members">清除條件</a>
</form>
<form method="post" action="/admin/members/bulk">
<table><thead><tr><th></th><th>會員</th><th>Email／登入</th><th>狀態</th><th>Battery 剩餘</th><th>加入／最近登入</th></tr></thead><tbody>
${result.members.map(
  (m) => html`<tr><td>${actor.role === 'support' ? '' : html`<input type="checkbox" name="ids" value="${m.user_id}" aria-label="選取 ${m.display_name ?? m.member_no ?? ''}">`}</td><td><a href="/admin/members/${m.user_id}">${m.display_name ?? '（未命名）'}</a><br><code>${m.member_no ?? '（發放中）'}</code>${m.role ? html`<br>${ROLE_LABELS[m.role]}` : ''}</td>
<td>${m.contact_email ?? m.emails.find((e) => e !== null) ?? '（無 Email）'}<br><span class="muted">${m.providers.map((p) => PROVIDER_LABELS[p] ?? p).join('、')}${m.country ? html`｜${m.country}` : ''}</span></td>
<td>${STATUS_LABELS[m.status] ?? m.status}</td>
<td>${m.battery ? html`<strong>${m.battery.remaining}</strong> / ${m.battery.allowance}` : '—'}</td>
<td>${formatTime(m.created_at)}<br><span class="muted">${m.last_login_at ? formatTime(m.last_login_at) : '—'}</span></td></tr>`,
)}
</tbody></table>
${result.members.length > 0 && actor.role !== 'support'
  ? html`<div class="card"><p><strong>批次操作</strong>（先勾選上面的會員，一次最多 ${MAX_BULK} 位；Battery、停權、登出不會處理自己、Owner 與管理人員）</p>
<label for="bulk-action">動作</label><select id="bulk-action" name="action"><option value="battery">調整本月 Battery（要填顆數）</option><option value="suspend">停權</option><option value="signout">強制登出所有裝置</option><option value="notify">發送推播通知（下方填 App、標題、內容）</option></select>
<label for="bulk-delta">顆數（正數增加、負數減少；只有調整 Battery 才需要）</label><input id="bulk-delta" name="delta" type="number" step="1">
<label for="bulk-reason">原因（必填，最多 200 字；發推播時不用填）</label><input id="bulk-reason" name="reason" maxlength="200">
<details><summary>發送推播通知（選「發送推播通知」才需要）</summary>
<label for="notify-app">App（只會送到會員在這款 App 的裝置）</label><select id="notify-app" name="notify_app"><option value="">請選擇</option>${[...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID).map((a) => html`<option value="${a.app_id}">${a.name}</option>`)}</select>
<label for="notify-title">標題（最多 100 字）</label><input id="notify-title" name="notify_title" maxlength="100">
<label for="notify-body">內容（最多 300 字，不要放個資）</label><textarea id="notify-body" name="notify_body" maxlength="300" rows="3"></textarea>
<p class="muted">只送給正常狀態、已開啟「公告」類別且有登入該 App 的會員；其他人會略過並在結果中列出人數。</p></details>
<button type="submit">執行</button>
<p class="muted">批次調整 Battery 不會寄通知信給會員。</p></div>`
  : ''}
</form>
${result.members.length === 0 ? html`<p class="muted">沒有符合的會員。</p>` : ''}
${next ? html`<p class="pager"><a href="${next}">下一頁</a></p>` : ''}`,
    ),
  );
});

export async function memberPage(c: WebContext, actor: StaffActor, userId: string, message?: string): Promise<Response> {
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const m = await findMemberSummary(db, c.env.DB_BATTERY, c.env.OWNER_USER_IDS, userId, now);
  if (!m) return c.html(adminPage(c, '找不到會員', html`<h1>找不到會員</h1>`), 404);
  // Names and emails are shown in full, so every time staff open a member is recorded.
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.member_viewed', targetType: 'user', targetId: m.user_id, result: 'success', requestId: actor.requestId, retention: 'general' }, now).run();
  const canModerate = hasRole(actor.role, 'admin') && m.role !== 'owner' && m.user_id !== actor.userId;
  const canAdjust = hasRole(actor.role, 'admin') && m.user_id !== actor.userId;
  const appManaged = actor.role === 'owner' ? await listAppStaff(c.env.DB_IDENTITY, m.user_id) : [];
  const [balance, usedApps, subs, grants, quantum, ledger, sessions, tickets] = await Promise.all([
    getBalance(c.env.DB_BATTERY, m.user_id, now),
    db.prepare('SELECT app_id, first_seen_at, last_seen_at FROM member_apps WHERE user_id = ? ORDER BY COALESCE(last_seen_at, first_seen_at) DESC').bind(m.user_id).all<{ app_id: string; first_seen_at: number; last_seen_at: number | null }>(),
    c.env.DB_BILLING.prepare('SELECT app_id, entitlement, expires_at, store, environment FROM entitlements WHERE user_id = ? AND active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY app_id, entitlement').bind(m.user_id, now).all<{ app_id: string; entitlement: string; expires_at: number | null; store: string | null; environment: string | null }>(),
    listGrants(c.env.DB_BILLING, m.user_id, now),
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
<p class="muted">快速跳到：<a href="#apps">用過的 App</a> ｜ <a href="#subs">訂閱與權益</a> ｜ <a href="#devices">登入裝置</a> ｜ <a href="#tickets">客服單</a> ｜ <a href="#battery">Battery</a> ｜ <a href="#quantum">量子電池</a> ｜ <a href="#grants">補發權益</a> ｜ <a href="#actions">管理動作</a></p>
<h2 id="apps">用過的 App</h2>
<div class="card">${usedApps.results.length > 0
  ? html`<table><thead><tr><th>App</th><th>第一次使用</th><th>最後使用</th></tr></thead><tbody>${usedApps.results.map((a) => html`<tr><td><code>${a.app_id}</code></td><td>${formatTime(a.first_seen_at)}</td><td>${a.last_seen_at ? formatTime(a.last_seen_at) : '—'}</td></tr>`)}</tbody></table>`
  : html`<p class="muted">還沒有使用過任何 App。</p>`}</div>
<h2 id="subs">訂閱與權益（商店購買）</h2>
<div class="card">${subs.results.length > 0
  ? html`<table><thead><tr><th>App</th><th>權益</th><th>到期</th><th>商店</th></tr></thead><tbody>${subs.results.map((s) => html`<tr><td><code>${s.app_id}</code></td><td><code>${s.entitlement}</code></td><td>${s.expires_at === null ? '買斷／無期限' : formatTime(s.expires_at)}</td><td>${s.store ?? '—'}${s.environment === 'SANDBOX' ? '（測試）' : ''}</td></tr>`)}</tbody></table>`
  : html`<p class="muted">沒有有效的商店訂閱或買斷。客服補發的權益在下方「補發權益」。</p>`}</div>
<h2 id="devices">登入中的裝置</h2>
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
<h2 id="tickets">客服單</h2>
<div class="card">
${tickets.results.length > 0
  ? html`<table><thead><tr><th>時間</th><th>類別</th><th>狀態</th></tr></thead><tbody>
${tickets.results.map((t) => html`<tr><td><a href="/admin/tickets/${t.ticket_id}">${formatTime(t.created_at)}</a></td><td>${CATEGORY_LABELS[t.category as keyof typeof CATEGORY_LABELS] ?? t.category}</td><td>${t.status === 'open' ? '未結' : '已結'}</td></tr>`)}
</tbody></table>`
  : html`<p class="muted">沒有客服單。</p>`}
</div>
<h2 id="battery">Starry Battery（${balance.period}）</h2>
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
<h2 id="quantum">量子電池（各 App 內購）</h2>
${quantum.length > 0
  ? html`<table><thead><tr><th>App</th><th>餘額</th><th>使用中</th></tr></thead><tbody>${quantum.map((q) => html`<tr><td><code>${q.app_id}</code></td><td>${q.balance}</td><td>${q.reserved}</td></tr>`)}</tbody></table>`
  : html`<p class="muted">沒有量子電池。</p>`}
${canAdjust
  ? html`<form method="post" action="/admin/members/${m.user_id}/quantum"><label for="q-app">App 代碼</label><input id="q-app" name="app_id" maxlength="64" required>
<label for="q-delta">調整顆數（正數增加、負數減少，不能低於 0）</label><input id="q-delta" name="delta" type="number" step="1" required>
<label for="q-reason">原因（必填，最多 200 字，會員看不到）</label><input id="q-reason" name="reason" maxlength="200" required><button type="submit">調整量子電池</button></form>`
  : ''}
</div>
<h2 id="grants">補發權益（客服）</h2>
<div class="card">
${grants.length > 0
  ? html`<table><thead><tr><th>App</th><th>權益</th><th>到期</th><th>原因</th><th></th></tr></thead><tbody>${grants.map((g) => html`<tr><td><code>${g.app_id}</code></td><td><code>${g.entitlement}</code></td><td>${g.expires_at === null ? '無期限' : formatTime(g.expires_at)}</td><td>${g.reason}</td><td>${canAdjust ? html`<form class="inline" method="post" action="/admin/members/${m.user_id}/grants/${g.grant_id}/revoke"><button class="secondary" type="submit">收回</button></form>` : ''}</td></tr>`)}</tbody></table>`
  : html`<p class="muted">沒有補發的權益。商店購買的權益由 RevenueCat 管理，不顯示在這裡。</p>`}
${canAdjust
  ? html`<form method="post" action="/admin/members/${m.user_id}/grants"><label for="g-app">App 代碼</label><input id="g-app" name="app_id" maxlength="64" required>
<label for="g-ent">權益名稱（要和 App 內的名稱完全一樣，例如 pro）</label><input id="g-ent" name="entitlement" maxlength="60" required>
<label for="g-exp">到期日（台灣時間，留空＝沒有期限）</label><input id="g-exp" name="expires" type="date">
<label for="g-reason">原因（必填，最多 200 字，會員看不到）</label><input id="g-reason" name="reason" maxlength="200" required><button type="submit">補發權益</button></form>`
  : ''}
</div>
${canModerate && m.status === 'active'
  ? html`<h2 id="actions">停權</h2><form method="post" action="/admin/members/${m.user_id}/suspend" class="card"><label for="reason">原因（必填，最多 200 字，會員看不到）</label><input id="reason" name="reason" maxlength="200" required><button class="danger" type="submit">停權</button></form>`
  : ''}
${canModerate && m.status === 'suspended'
  ? html`<h2>復權</h2><form method="post" action="/admin/members/${m.user_id}/restore" class="card"><p>復權後會員需要重新登入。</p><button type="submit">復權</button></form>`
  : ''}
${actor.role === 'owner'
  ? html`<h2>修改會員編號</h2><form method="post" action="/admin/members/${m.user_id}/member-no" class="card"><p>格式：2 個英文字母的國家代碼加 7 位數字，例如 TW0112342。修改後此會員的公開個人頁與邀請連結會一起改變，舊連結失效；組織網不受影響。需要 Passkey 驗證。</p>
<label for="new-no">新的會員編號</label><input id="new-no" name="no" autocomplete="off" maxlength="9" required value="${m.member_no ?? ''}"><button type="submit">修改編號</button></form>`
  : ''}
${actor.role === 'owner' && m.role !== 'owner' && m.user_id !== actor.userId
  ? html`<h2>永久刪除會員</h2><form method="post" action="/admin/members/${m.user_id}/delete" class="card"><p>立即永久刪除這位會員的所有資料，無法復原；會員編號會釋放給日後的新會員。</p>
<label for="confirm">請輸入大寫英文 DELETE 以確認</label><input id="confirm" name="confirm" autocomplete="off" required><button class="danger" type="submit">永久刪除</button></form>`
  : ''}
${actor.role === 'owner' && m.user_id !== actor.userId
  ? html`<h2 id="staff-apps">App 管理員與客服</h2><div class="card"><p class="muted">管理員：只能管理指定 App 的遠端設定，並檢視量子電池商品與 RevenueCat 狀態。客服：只能看指定 App 的客服單與用過該 App 的會員（唯讀），可回覆與結案。兩者都看不到其他 App 與全站資料。</p>
${appManaged.length > 0 ? html`<ul>${appManaged.map((a) => html`<li><code>${a.app_id}</code>（${a.kind === 'support' ? '客服' : '管理員'}） <form class="inline" method="post" action="/admin/members/${m.user_id}/app-staff"><input type="hidden" name="app_id" value="${a.app_id}"><input type="hidden" name="kind" value="${a.kind}"><input type="hidden" name="grant" value="0"><button class="secondary" type="submit">取消</button></form></li>`)}</ul>` : html`<p class="muted">沒有指派任何 App。</p>`}
<form method="post" action="/admin/members/${m.user_id}/app-staff"><label for="as-app">App 代碼</label><input id="as-app" name="app_id" maxlength="64" required>
<label for="as-kind">身分</label><select id="as-kind" name="kind"><option value="manager">App 管理員（遠端設定）</option><option value="support">App 客服（客服單與會員，唯讀）</option></select>
<input type="hidden" name="grant" value="1"><button type="submit">指派</button></form></div>`
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
  const actor = await supportAccess(c);
  if (actor instanceof Response) return actor;
  if (actor.appScope) return scopedMemberPage(c, actor, c.req.param('id'));
  return memberPage(c, actor, c.req.param('id'));
});

const MAX_BULK = 50;

adminApp.post('/members/bulk', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const body = await c.req.parseBody({ all: true });
  const raw = body.ids;
  const ids = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)))];
  const action = typeof body.action === 'string' ? body.action : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const delta = Number(typeof body.delta === 'string' ? body.delta : '');
  const back = (message: string) => c.html(adminPage(c, '批次操作結果', html`<h1>批次操作結果</h1><div class="banner">${message}</div><p><a href="/admin/members">回到會員清單</a></p>`));
  if (ids.length === 0) return back('請先勾選至少一位會員。');
  if (ids.length > MAX_BULK) return back(`一次最多 ${MAX_BULK} 位，請分批處理。`);
  if (!['battery', 'suspend', 'signout', 'notify'].includes(action)) return back('請選擇動作。');
  if (action === 'notify') {
    const appId = typeof body.notify_app === 'string' ? body.notify_app : '';
    const title = typeof body.notify_title === 'string' ? body.notify_title.trim() : '';
    const text = typeof body.notify_body === 'string' ? body.notify_body.trim() : '';
    if (!getApp(appId) || appId === WEB_APP_ID) return back('請選擇要發送的 App。');
    if (title.length < 1 || title.length > 100) return back('標題需為 1～100 字。');
    if (text.length < 1 || text.length > 300) return back('內容需為 1～300 字。');
    const summary = await bulkPush(c.env.DB_IDENTITY, (input, init) => fetch(input, init), ids, { appId, title, body: text }, { accessToken: c.env.EXPO_PUSH_ACCESS_TOKEN });
    await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.bulk_notify', targetType: 'app', targetId: appId, appId, result: summary.failed > 0 && summary.reached === 0 ? 'error' : 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
    const parts = [`已送達 ${summary.reached} 位（${summary.devices} 台裝置）`, `略過：已關閉公告 ${summary.optedOut} 位、沒有這款 App 的裝置 ${summary.noDevices} 位、非正常狀態 ${summary.inactive} 位`];
    if (summary.failed > 0) parts.push(`發送失敗 ${summary.failed} 位（推播服務錯誤，可稍後重試）`);
    return back(`${parts.join('；')}。`);
  }
  if (action !== 'signout' && (reason.length < 1 || reason.length > 200)) return back('請填寫 1～200 字的原因。');
  if (action === 'battery' && (!Number.isInteger(delta) || delta === 0)) return back('請填寫非 0 的整數顆數。');
  const now = Date.now();
  let done = 0;
  let skipped = 0;
  for (const id of ids) {
    if (id === actor.userId) {
      skipped++;
      continue;
    }
    let ok = false;
    if (action === 'suspend') ok = (await suspendMember(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, id, reason, now)) === 'ok';
    else if (action === 'signout') ok = (await revokeAllSessions(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, id, now)) === 'ok';
    else {
      const target = await findMemberSummary(c.env.DB_IDENTITY, null, c.env.OWNER_USER_IDS, id, now);
      if (target && !target.role) {
        ok = (await adjustAllowance(c.env.DB_BATTERY, { userId: id, delta, reason, actorUserId: actor.userId }, now)).ok;
        if (ok) await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.battery_adjusted', targetType: 'user', targetId: id, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
      }
    }
    if (ok) done++;
    else skipped++;
  }
  return back(`已處理 ${done} 位，略過 ${skipped} 位（自己、管理人員、停權不適用或額度不允許的會員會被略過）。`);
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
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const userId = c.req.param('id');
  const m = await findMemberSummary(c.env.DB_IDENTITY, null, c.env.OWNER_USER_IDS, userId, Date.now());
  if (!m) return memberPage(c, actor, userId);
  if (m.user_id === actor.userId || m.role === 'owner') return memberPage(c, actor, userId, RESULT_TEXT.not_allowed);
  if (((await readForm(c)).confirm ?? '').trim() !== 'DELETE') return memberPage(c, actor, userId, '請輸入大寫英文 DELETE 才能刪除。');
  const now = Date.now();
  const result = await deleteMemberNow(c.env.DB_IDENTITY, { userId: m.user_id, appId: null, requestId: actor.requestId, staffId: actor.userId }, now);
  if (!result.ok) return memberPage(c, actor, userId);
  await cleanupAfterDeletion(c.env, m.user_id, result.avatarKey, now);
  return c.html(adminPage(c, '會員已刪除', html`<h1>會員已刪除</h1><div class="banner">已永久刪除會員 <code>${result.memberNo ?? ''}</code>，編號已釋放。</div><p><a href="/admin/members">回到會員列表</a></p>`));
});

adminApp.post('/members/:id/member-no', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const userId = c.req.param('id');
  const m = await findMemberSummary(c.env.DB_IDENTITY, null, c.env.OWNER_USER_IDS, userId, Date.now());
  if (!m) return memberPage(c, actor, userId);
  const result = await changeMemberNo(c.env.DB_IDENTITY, { userId: m.user_id, requested: (await readForm(c)).no ?? '', byAdminId: actor.userId, requestId: actor.requestId }, Date.now());
  const text = result.ok
    ? result.unchanged ? '編號沒有變更。' : `已將會員編號改為 ${result.memberNo}。`
    : result.reason === 'invalid' ? '編號格式不正確：需要 2 個英文字母的國家代碼加 7 位數字。' : result.reason === 'taken' ? '這個編號已經有人使用。' : '找不到會員。';
  return memberPage(c, actor, userId, text);
});

adminApp.post('/members/:id/restore', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const result = await restoreMember(c.env.DB_IDENTITY, actor, c.req.param('id'), Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.post('/members/:id/app-staff', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const userId = c.req.param('id');
  const form = await readForm(c);
  const appId = (form.app_id ?? '').trim();
  if (userId === actor.userId || !getApp(appId) || appId === WEB_APP_ID) return memberPage(c, actor, userId, '請填寫有效的 App 代碼。');
  const kind = form.kind === 'support' ? 'support' : 'manager';
  const ok = await setAppStaff(c.env.DB_IDENTITY, actor, userId, appId, form.grant === '1', Date.now(), kind);
  return memberPage(c, actor, userId, ok ? (kind === 'support' ? '已更新 App 客服。' : '已更新 App 管理員。') : '找不到此會員。');
});

adminApp.post('/members/:id/role', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const value = (await readForm(c)).role;
  const role = value === 'admin' || value === 'support' ? value : value === 'none' ? null : undefined;
  if (role === undefined) return memberPage(c, actor, c.req.param('id'), '請選擇角色。');
  const result = await setStaffRole(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, actor, c.req.param('id'), role, Date.now());
  return memberPage(c, actor, c.req.param('id'), RESULT_TEXT[result]);
});

adminApp.post('/members/:id/battery', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
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

export const TIMEOUT_SECONDS = (ms: number | null) => (ms === null ? '' : String(Math.round(ms / 1000)));
