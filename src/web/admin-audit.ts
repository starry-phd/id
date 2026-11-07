import { html } from 'hono/html';
import { listAudit } from '../identity/audit-query';
import { formatTime } from './layout';
import { adminApp, adminPage, staff } from './admin-lib';

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
