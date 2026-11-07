import { html } from 'hono/html';
import { findMemberSummary, searchMembers } from '../identity/member-search';
import { auditStatement } from '../lib/audit';
import { CATEGORY_LABELS } from '../support/tickets';
import { type StaffActor } from '../identity/roles';
import { formatTime, type WebContext } from './layout';
import { STATUS_LABELS, adminPage } from './admin-lib';

/**
 * Member pages for an App-scoped support person (Owner-assigned, kind 'support'): read-only, limited to members who
 * have used one of their Apps, and showing only that App's slice (usage, purchases, tickets). No Battery, no other
 * Apps, no devices, no roles, no audit trail, no actions.
 */
export async function scopedMembersPage(c: WebContext, actor: StaffActor): Promise<Response> {
  const scope = actor.appScope ?? [];
  const q = c.req.query('q') ?? '';
  const status = c.req.query('status') === 'suspended' ? 'suspended' : c.req.query('status') === 'active' ? 'active' : '';
  const result = await searchMembers(c.env.DB_IDENTITY, null, c.env.OWNER_USER_IDS, { query: q, status: status || undefined, appIds: scope, cursor: c.req.query('cursor') }, Date.now());
  const params = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(result.nextCursor ? { cursor: result.nextCursor } : {}) }).toString();
  return c.html(
    adminPage(
      c,
      '會員',
      html`<h1>會員</h1>
<p class="muted">你只看得到用過 ${scope.map((a) => html`<code>${a}</code> `)} 的會員。</p>
<form method="get" action="/admin/members" class="card">
<label for="q">關鍵字（會員編號、姓名、Email，輸入一部分即可）</label><input id="q" name="q" value="${q}">
<label for="status">狀態</label><select id="status" name="status"><option value="">全部</option><option value="active"${status === 'active' ? ' selected' : ''}>正常</option><option value="suspended"${status === 'suspended' ? ' selected' : ''}>停權</option></select>
<button type="submit">查詢</button>&emsp;<a href="/admin/members">清除條件</a>
</form>
<table><thead><tr><th>會員</th><th>Email</th><th>狀態</th><th>加入</th></tr></thead><tbody>
${result.members.map(
  (m) => html`<tr><td><a href="/admin/members/${m.user_id}">${m.display_name ?? '（未命名）'}</a><br><span class="muted">${m.member_no ?? ''}</span></td><td>${m.contact_email ?? m.emails.find((e) => e !== null) ?? '（無 Email）'}</td><td>${STATUS_LABELS[m.status] ?? m.status}</td><td>${formatTime(m.created_at)}</td></tr>`,
)}
</tbody></table>
${result.members.length === 0 ? html`<p class="muted">沒有符合的會員。</p>` : ''}
${result.nextCursor ? html`<p class="pager"><a href="/admin/members?${params}">下一頁</a></p>` : ''}`,
      undefined,
      actor,
    ),
  );
}

export async function scopedMemberPage(c: WebContext, actor: StaffActor, userId: string): Promise<Response> {
  const scope = actor.appScope ?? [];
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const notFound = () => c.html(adminPage(c, '找不到會員', html`<h1>找不到會員</h1>`, undefined, actor), 404);
  const m = await findMemberSummary(db, null, c.env.OWNER_USER_IDS, userId, now);
  if (!m) return notFound();
  const marks = scope.map(() => '?').join(',');
  const [used, tickets] = await Promise.all([
    db.prepare(`SELECT app_id, first_seen_at, last_seen_at FROM member_apps WHERE user_id = ? AND app_id IN (${marks}) ORDER BY app_id`).bind(m.user_id, ...scope).all<{ app_id: string; first_seen_at: number; last_seen_at: number | null }>(),
    db
      .prepare(`SELECT ticket_id, created_at, category, app_id, status FROM support_tickets WHERE user_id = ? AND app_id IN (${marks}) ORDER BY ticket_id DESC LIMIT 10`)
      .bind(m.user_id, ...scope)
      .all<{ ticket_id: string; created_at: number; category: string; app_id: string; status: string }>(),
  ]);
  // Members who never used one of the person's Apps look exactly like missing members.
  if (used.results.length === 0) return notFound();
  const subs = await c.env.DB_BILLING
    .prepare(`SELECT app_id, entitlement, expires_at, store FROM entitlements WHERE user_id = ? AND active = 1 AND app_id IN (${marks}) AND (expires_at IS NULL OR expires_at > ?) AND (environment IS NULL OR environment != 'SANDBOX') ORDER BY app_id, entitlement`)
    .bind(m.user_id, ...scope, now)
    .all<{ app_id: string; entitlement: string; expires_at: number | null; store: string }>();
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.member_viewed', targetType: 'user', targetId: m.user_id, result: 'success', requestId: actor.requestId, retention: 'general' }, now).run();
  return c.html(
    adminPage(
      c,
      '會員資料',
      html`<h1>${m.display_name ?? '（未命名）'}</h1>
<div class="card"><p><strong>會員編號：</strong><code>${m.member_no ?? '（發放中）'}</code><br>
<strong>聯絡 Email：</strong>${m.contact_email ?? m.emails.find((e) => e !== null) ?? '（無 Email）'}<br>
<strong>狀態：</strong>${STATUS_LABELS[m.status] ?? m.status}<br>
<strong>加入：</strong>${formatTime(m.created_at)}</p>
<p class="muted">這是唯讀的客服檢視，只顯示你負責的 App。</p></div>
<h2>用過的 App</h2>
<div class="card"><table><thead><tr><th>App</th><th>第一次使用</th><th>最後使用</th></tr></thead><tbody>${used.results.map((a) => html`<tr><td><code>${a.app_id}</code></td><td>${formatTime(a.first_seen_at)}</td><td>${a.last_seen_at ? formatTime(a.last_seen_at) : '—'}</td></tr>`)}</tbody></table></div>
<h2>訂閱與權益</h2>
<div class="card">${subs.results.length > 0
  ? html`<table><thead><tr><th>App</th><th>權益</th><th>到期</th><th>來源</th></tr></thead><tbody>${subs.results.map((s) => html`<tr><td><code>${s.app_id}</code></td><td><code>${s.entitlement}</code></td><td>${s.expires_at === null ? '長期' : formatTime(s.expires_at)}</td><td>${s.store}</td></tr>`)}</tbody></table>`
  : html`<p class="muted">沒有有效的訂閱或買斷。</p>`}</div>
<h2>客服單</h2>
<div class="card">${tickets.results.length > 0
  ? html`<table><thead><tr><th>時間</th><th>類別</th><th>App</th><th>狀態</th></tr></thead><tbody>${tickets.results.map((t) => html`<tr><td><a href="/admin/tickets/${t.ticket_id}">${formatTime(t.created_at)}</a></td><td>${CATEGORY_LABELS[t.category as keyof typeof CATEGORY_LABELS] ?? t.category}</td><td><code>${t.app_id}</code></td><td>${t.status === 'open' ? '未結' : '已結'}</td></tr>`)}</tbody></table>`
  : html`<p class="muted">沒有客服單。</p>`}</div>`,
      undefined,
      actor,
    ),
  );
}
