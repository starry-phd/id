import { html } from 'hono/html';
import { revenueSummary, type RevenueRow } from '../billing/revenue';
import { appLabel } from './account-lib';
import { adminApp, adminPage, staff } from './admin-lib';

const RANGES: Record<string, number> = { '7': 7, '30': 30, '90': 90 };
const usd = (n: number) => `US$ ${n.toFixed(2)}`;

function table(rows: RevenueRow[]) {
  if (rows.length === 0) return html`<p class="muted">這段期間沒有紀錄。</p>`;
  return html`<table><thead><tr><th>App</th><th>目前有效會員</th><th>新購買</th><th>續訂</th><th>一次性</th><th>取消／退款</th><th>到期</th><th>付款失敗</th><th>營收</th><th>退款</th></tr></thead><tbody>
${rows.map((r) => html`<tr><td>${appLabel(r.appId)}</td><td>${r.activeNow}</td><td>${r.newPurchases}</td><td>${r.renewals}</td><td>${r.oneTime}</td><td>${r.cancellations}</td><td>${r.expirations}</td><td>${r.billingIssues}</td><td>${usd(r.revenueUsd)}</td><td>${usd(r.refundedUsd)}</td></tr>`)}
</tbody></table>`;
}

adminApp.get('/revenue', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const days = RANGES[c.req.query('days') ?? ''] ?? 30;
  const rows = await revenueSummary(c.env.DB_BILLING, Date.now() - days * 24 * 60 * 60 * 1000);
  return c.html(
    adminPage(
      c,
      '營收',
      html`<h1>營收</h1>
<form method="get" action="/admin/revenue" class="card"><label for="days">統計期間</label><select id="days" name="days">${Object.keys(RANGES).map((d) => html`<option value="${d}" ${String(days) === d ? 'selected' : ''}>最近 ${d} 天</option>`)}</select><button type="submit">查看</button></form>
<p class="muted">金額是 RevenueCat 事件上的美元價格加總，只供參考，不是帳務。以商店與 RevenueCat 後台為準。</p>
<h2>正式購買</h2>
${table(rows.filter((r) => !r.sandbox))}
<h2>測試購買（不計入營運數字）</h2>
${table(rows.filter((r) => r.sandbox))}`,
    ),
  );
});
