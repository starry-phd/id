import { html } from 'hono/html';
import { appChecks, gatherStatus, pendingItems } from '../apps/integration-status';
import { invalidRegisteredApps } from '../apps/dynamic';
import { appRegistry } from '../apps/registry';
import { centralTeamId, saveCentralTeamId } from '../apps/team-id';
import { readForm } from './layout';
import { HANDOFF_UPDATED, HANDOFF_VERSION } from '../apps/handoff';
import { WEB_APP_ID } from '../identity/web-sessions';
import { adminApp, adminPage, requireStepUp, staff } from './admin-lib';

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
<div class="card"><p>Apple Team ID（全生態系共用，儲存於中央 D1）：${team ? html`<strong>${team}</strong> ✅` : html`<strong>尚未設定</strong> ⚠️`}</p>
${actor.role === 'owner' ? html`<form method="post" action="/admin/apps/team-id"><label for="apple_team_id">中央 Apple Team ID（10 位英數；所有 App 自動繼承）</label><input id="apple_team_id" name="apple_team_id" value="${team ?? ''}" maxlength="10" minlength="10" pattern="[A-Za-z0-9]{10}" required><button type="submit">更新中央 Team ID（需 Passkey 二次確認）</button></form><p class="muted">修改後 AASA 最多有 5 分鐘的公開快取，iOS 裝置可能還需要重新驗證關聯。這不是各 App 的登入 Client ID。</p>` : ''}
${c.req.query('team_updated') ? html`<p>中央 Team ID 已儲存並寫入稽核。</p>` : ''}
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

/** Only the Owner can change the single central D1 setting; App staff cannot. */
adminApp.post('/apps/team-id', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const form = await readForm(c);
  const result = await saveCentralTeamId(c.env.DB_IDENTITY, actor, form.apple_team_id ?? '', Date.now());
  if (result === 'invalid') return c.text('Apple Team ID 必須是 10 位英數字元。', 400);
  return c.redirect('/admin/apps/status?team_updated=1', 303);
});
