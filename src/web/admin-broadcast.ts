import { html } from 'hono/html';
import { appRegistry, getApp } from '../apps/registry';
import { WEB_APP_ID } from '../identity/web-sessions';
import { auditStatement } from '../lib/audit';
import { audienceSize, BROADCAST_MAX_MEMBERS, recentBroadcasts, startBroadcast } from '../notify/broadcast';
import { readForm, type WebContext } from './layout';
import { adminApp, adminPage, requireStepUp, staff } from './admin-lib';

const taipei = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);

async function broadcastPage(c: WebContext, message?: string, draft: { app?: string; title?: string; body?: string } = {}): Promise<Response> {
  const apps = [...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID);
  const sizes = new Map(await Promise.all(apps.map(async (a) => [a.app_id, await audienceSize(c.env.DB_IDENTITY, a.app_id)] as const)));
  const history = await recentBroadcasts(c.env.DB_IDENTITY);
  const ready = Boolean(c.env.NOTIFY_QUEUE);
  return c.html(
    adminPage(
      c,
      '全 App 推播',
      html`<h1>全 App 推播</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<div class="card"><p class="muted">發給某款 App 的所有會員（只送到有登記推播裝置的正常會員），在背景分批送出，關閉公告類別的會員會略過。內容不可放個資。少數幾位請用會員清單的「發送推播通知」。一次最多 ${BROADCAST_MAX_MEMBERS} 位。</p>
${ready ? '' : html`<p class="banner danger">推播佇列尚未啟用（沒有 NOTIFY_QUEUE 綁定），目前無法發送。</p>`}
<form method="post" action="/admin/broadcast"><label for="bc-app">App</label>
<select id="bc-app" name="app_id">${apps.map((a) => html`<option value="${a.app_id}" ${draft.app === a.app_id ? 'selected' : ''}>${a.name}（${sizes.get(a.app_id) ?? 0} 位有裝置）</option>`)}</select>
<label for="bc-title">標題（1～100 字）</label><input id="bc-title" name="title" maxlength="100" required value="${draft.title ?? ''}">
<label for="bc-body">內容（1～300 字）</label><textarea id="bc-body" name="body" maxlength="300" rows="4" required>${draft.body ?? ''}</textarea>
<label><input type="checkbox" name="confirm" value="1" required> 我確認要發送給這款 App 的所有會員</label>
<button type="submit" ${ready ? '' : 'disabled'}>發送</button></form></div>
<h2>最近的推播</h2>
<div class="card"><table><thead><tr><th>時間（台灣）</th><th>App</th><th>標題</th><th>進度</th><th>送達</th><th>略過</th><th>失敗</th></tr></thead><tbody>
${history.map((h) => html`<tr><td>${taipei(h.created_at)}</td><td><code>${h.app_id}</code></td><td>${h.title}</td><td>${h.finished_at ? '完成' : `${h.chunks_done}／${h.chunks_total}`}</td><td>${h.reached} 位（${h.devices} 台）</td><td>${h.opted_out + h.no_devices + h.inactive}</td><td>${h.failed}</td></tr>`)}
</tbody></table>${history.length === 0 ? html`<p class="muted">還沒有發過。</p>` : ''}</div>
<p><a href="/admin">回到首頁</a></p>`,
    ),
  );
}

adminApp.get('/broadcast', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  return broadcastPage(c);
});

adminApp.post('/broadcast', async (c) => {
  const actor = await staff(c, 'admin');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const form = await readForm(c);
  const appId = form.app_id ?? '';
  const title = (form.title ?? '').trim();
  const text = (form.body ?? '').trim();
  const draft = { app: appId, title, body: text };
  if (!getApp(appId) || appId === WEB_APP_ID) return broadcastPage(c, '請選擇要發送的 App。', draft);
  if (title.length < 1 || title.length > 100) return broadcastPage(c, '標題需為 1～100 字。', draft);
  if (text.length < 1 || text.length > 300) return broadcastPage(c, '內容需為 1～300 字。', draft);
  if (form.confirm !== '1') return broadcastPage(c, '請勾選確認。', draft);
  if (!c.env.NOTIFY_QUEUE) return broadcastPage(c, '推播佇列尚未啟用，無法發送。', draft);
  const now = Date.now();
  const result = await startBroadcast(c.env.DB_IDENTITY, c.env.NOTIFY_QUEUE, { appId, title, body: text, actorUserId: actor.userId }, now);
  if (!result.ok) {
    const reason = { empty: '這款 App 沒有可發送的會員（沒有人登記推播裝置）。', too_many: `會員超過 ${BROADCAST_MAX_MEMBERS} 位，請先聯絡開發者。`, queue_failed: '送進佇列失敗，沒有發出任何通知，可稍後重試。' }[result.error];
    return broadcastPage(c, reason, draft);
  }
  // Only the App is audited, never the text (same rule as the bulk action).
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.broadcast_notify', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'general' }, now).run();
  return broadcastPage(c, `已排入 ${result.members} 位會員（${result.chunks} 批），背景送出中，進度見下方。`);
});
