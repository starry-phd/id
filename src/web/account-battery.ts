import { html } from 'hono/html';
import { getApp } from '../apps/registry';
import { recentActivity } from '../battery/battery';
import { quantumHistory } from '../battery/quantum';
import { BATTERY_ICON } from '../lib/battery-icons';
import { accountApp } from './account-lib';
import { formatTime, page } from './layout';

const QUANTUM_KIND: Record<string, string> = { purchase: '入帳', usage: '使用', refund: '退回', adjustment: '調整' };
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * GET /account/battery[?app=<app id>&cursor=<entry id>] — 電池消耗明細: the member's own last 30 days of 🔋 usage and
 * adjustments, plus ⚛️ history in one App when `app` is given. The button of the same name on every App's settings
 * page opens this page (through POST /v1/me/web-link with page "battery"). Adjustment reasons stay internal.
 */
accountApp.get('/battery', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/battery', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const requested = c.req.query('app') ?? '';
  const app = requested && requested !== 'account' ? getApp(requested) : undefined;
  const cursor = /^[A-Za-z0-9_-]{1,64}$/.test(c.req.query('cursor') ?? '') ? c.req.query('cursor') : undefined;
  const [activity, quantum] = await Promise.all([
    recentActivity(c.env.DB_BATTERY, web.userId, Date.now(), { cursor, limit: 50 }),
    app ? quantumHistory(c.env.DB_BATTERY, web.userId, app.app_id, 30) : Promise.resolve([]),
  ]);
  const more = activity.nextCursor ? `/account/battery?${new URLSearchParams({ ...(app ? { app: app.app_id } : {}), cursor: activity.nextCursor }).toString()}` : null;
  const body = html`<h1>電池消耗明細</h1>
<h2>${BATTERY_ICON.normal} 普通電池</h2>
${activity.entries.length > 0
  ? html`<table><thead><tr><th>時間</th><th>項目</th><th>數量</th></tr></thead><tbody>${activity.entries.map(
      (e) => html`<tr><td>${formatTime(e.created_at)}</td><td>${e.kind === 'usage' ? html`${e.task_label ?? e.task_type ?? ''}${e.app_id ? html`<br><span class="muted">${getApp(e.app_id)?.name ?? e.app_id}</span>` : ''}` : '調整'}</td><td>${e.kind === 'usage' ? `-${e.amount}` : signed(e.amount)}</td></tr>`,
    )}</tbody></table>${more ? html`<p><a href="${more}">更多</a></p>` : ''}`
  : html`<p class="muted">沒有紀錄</p>`}
${app
  ? html`<h2>${BATTERY_ICON.quantum} 量子電池</h2>${quantum.length > 0
      ? html`<table><thead><tr><th>時間</th><th>項目</th><th>數量</th></tr></thead><tbody>${quantum.map(
          (q) => html`<tr><td>${formatTime(q.created_at)}</td><td>${q.kind === 'usage' ? (q.task_label ?? QUANTUM_KIND.usage) : (QUANTUM_KIND[q.kind] ?? q.kind)}</td><td>${signed(q.amount)}</td></tr>`,
        )}</tbody></table>`
      : html`<p class="muted">沒有紀錄</p>`}`
  : ''}`;
  c.header('cache-control', 'no-store');
  return c.html(page(c, '電池消耗明細', body));
});
