import { html } from 'hono/html';
import { appChecks, gatherStatus, pendingItems } from '../apps/integration-status';
import { invalidRegisteredApps } from '../apps/dynamic';
import { appRegistry } from '../apps/registry';
import { centralTeamId } from '../apps/team-id';
import { HANDOFF_UPDATED, HANDOFF_VERSION } from '../apps/handoff';
import { WEB_APP_ID } from '../identity/web-sessions';
import { adminApp, adminPage, staff } from './admin-lib';

const MARK = { ok: '✅', todo: '⚠️', na: '—' } as const;

/** One page that lists, for every App, what is connected and what the Owner still has to do. Read-only. */
adminApp.get('/apps/status', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const apps = appRegistry.values().filter((a) => a.app_id !== WEB_APP_ID);
  const inputs = await gatherStatus(c.env, apps);
  const invalid = invalidRegisteredApps();
  const team = centralTeamId(c.env);
  const rows = apps.map((app) => {
    const checks = appChecks(app, inputs.get(app.app_id)!, c.env);
    return { app, checks, pending: pendingItems(checks) };
  });
  const total = rows.reduce((sum, r) => sum + r.pending.length, 0);
  return c.html(
    adminPage(
      c,
      '整合狀態總覽',
      html`<h1>整合狀態總覽</h1>
<div class="card"><p>Apple Team ID（全生態系共用）：${team ? html`<strong>${team}</strong> ✅` : html`<strong>尚未設定</strong> ⚠️（在 wrangler.jsonc 的 STARRY_APPLE_TEAM_ID 設定）`}</p>
<p>目前串接指令版本 <strong>${HANDOFF_VERSION}</strong>（${HANDOFF_UPDATED}）｜待處理共 <strong>${total}</strong> 項</p></div>
${invalid.length > 0 ? html`<div class="banner danger">登記資料無法通過檢查：${invalid.join('、')}。系統暫時沿用上一次正常的版本，請到「編輯登記資料」修正後儲存。</div>` : ''}
${rows.map(({ app, checks, pending }) => html`<div class="card"><p><strong>${app.name}</strong> <code>${app.app_id}</code> ${pending.length === 0 ? '✅ 沒有待處理項目' : html`⚠️ 待處理 ${pending.length} 項`}</p>
<table><tbody>${checks.map((k) => html`<tr><td>${MARK[k.state]}</td><td>${k.label}</td><td>${k.text}</td></tr>`)}</tbody></table>
<p><a href="/admin/apps/${app.app_id}/handoff">串接指令</a>｜<a href="/admin/apps/${app.app_id}/config">遠端設定</a>｜<a href="/admin/apps/${app.app_id}/edit">編輯登記資料</a></p></div>`)}
<p class="muted">✅ 已完成｜⚠️ 需要你處理｜— 這款 App 不需要。Android 指紋不會假裝：沒登記就是未完成，原生 Passkey 要實機測試後才算通過。</p>
<p><a href="/admin/apps">回到 App 清單</a></p>`,
    ),
  );
});
