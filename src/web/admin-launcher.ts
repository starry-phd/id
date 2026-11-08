import { html } from 'hono/html';
import { appRegistry } from '../apps/registry';
import { ICON_MAX_BYTES, launcherItems, listLauncherRows, moveLauncher, removeLauncherIcon, resetLauncher, saveLauncherIcon, saveLauncherText } from '../apps/launcher';
import { audit as writeAudit } from '../lib/audit';
import { readForm, type WebContext } from './layout';
import { adminApp, adminPage, staff } from './admin-lib';
import { iconUrl } from './launcher-icons';

async function listPage(c: WebContext, message?: string): Promise<Response> {
  const items = launcherItems(await listLauncherRows(c.env.DB_IDENTITY), true);
  return c.html(
    adminPage(
      c,
      '九宮格 App',
      html`<h1>九宮格 App</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p class="muted">會員在主選單右上角九宮格看到的 App 清單。可以改圖示、名稱、網頁與商店連結、簡易說明，以及用 ↑ ↓ 調整顯示順序。暫停的 App 會灰階顯示，killed 的不會出現。</p>
<div class="card">${items.map(
        (i, n) => html`<div class="row" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line)">
<span style="width:36px;height:36px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:var(--line);flex:none">${i.iconKey ? html`<img src="${iconUrl(i.appId, i.iconKey)}" alt="" width="36" height="36">` : [...i.name][0]}</span>
<span style="flex:1;min-width:0"><b>${i.name}</b><br><span class="muted">${i.summary ?? '（沒有說明）'}</span></span>
<form method="post" action="/admin/launcher/move" style="margin:0"><input type="hidden" name="app_id" value="${i.appId}"><button class="secondary" name="dir" value="up" type="submit" aria-label="上移"${n === 0 ? ' disabled' : ''}>↑</button><button class="secondary" name="dir" value="down" type="submit" aria-label="下移"${n === items.length - 1 ? ' disabled' : ''}>↓</button></form>
<a class="button secondary" href="/admin/launcher/${i.appId}">編輯</a></div>`,
      )}</div>`,
    ),
  );
}

async function editPage(c: WebContext, appId: string, message?: string): Promise<Response> {
  const rows = await listLauncherRows(c.env.DB_IDENTITY);
  const item = launcherItems(rows, true).find((i) => i.appId === appId);
  const row = rows.get(appId);
  if (!item) return listPage(c, '找不到此 App。');
  return c.html(
    adminPage(
      c,
      '編輯九宮格 App',
      html`<h1>編輯：${item.name}</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<div class="card"><form method="post" action="/admin/launcher/${appId}" enctype="multipart/form-data">
<label for="icon">圖示圖片（PNG、JPG、WebP，300 KB 內，建議正方形）</label>
${item.iconKey ? html`<p><img src="${iconUrl(appId, item.iconKey)}" alt="目前圖示" width="64" height="64" style="border-radius:50%"></p>` : ''}
<input id="icon" name="icon" type="file" accept="image/png,image/jpeg,image/webp">
<label for="name">應用名稱（留空＝${appRegistry.get(appId)?.name ?? ''}）</label><input id="name" name="name" maxlength="40" value="${row?.name ?? ''}">
<label for="web">網頁版網址（https://…；留空＝自動）</label><input id="web" name="web" maxlength="300" inputmode="url" value="${row?.web_url ?? ''}">
<label for="play">Google Play 網址</label><input id="play" name="play" maxlength="300" inputmode="url" value="${row?.play_url ?? ''}">
<label for="appstore">App Store 網址</label><input id="appstore" name="appstore" maxlength="300" inputmode="url" value="${row?.appstore_url ?? ''}">
<label for="summary">簡易說明（最多 60 字）</label><input id="summary" name="summary" maxlength="60" value="${row?.summary ?? ''}">
<button type="submit">儲存</button></form></div>
<div class="actions">${item.iconKey ? html`<form method="post" action="/admin/launcher/${appId}/icon-remove" style="margin:0"><button class="secondary" type="submit">移除圖示</button></form>` : ''}<form method="post" action="/admin/launcher/${appId}/reset" style="margin:0"><button class="secondary" type="submit">全部還原預設</button></form></div>
<p><a href="/admin/launcher">回到九宮格清單</a></p>`,
    ),
  );
}

async function audit(c: WebContext, actorId: string, action: string, appId: string): Promise<void> {
  await writeAudit(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actorId, action, targetType: 'app_launcher', targetId: appId.slice(0, 64), appId, result: 'success', requestId: c.get('requestId'), retention: 'general' }, Date.now());
}

adminApp.get('/launcher', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  return listPage(c);
});

adminApp.post('/launcher/move', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const form = await readForm(c);
  const moved = await moveLauncher(c.env.DB_IDENTITY, form.app_id ?? '', form.dir === 'up' ? 'up' : 'down', actor.userId, Date.now());
  if (moved) await audit(c, actor.userId, 'admin.launcher_moved', form.app_id ?? '');
  return listPage(c, moved ? '已調整順序。' : undefined);
});

adminApp.get('/launcher/:id', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  return editPage(c, c.req.param('id'));
});

adminApp.post('/launcher/:id', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const appId = c.req.param('id');
  if (!appRegistry.has(appId)) return listPage(c, '找不到此 App。');
  let body: Record<string, string | File | (string | File)[]> = {};
  try {
    body = await c.req.parseBody();
  } catch {
    return editPage(c, appId, '表單讀取失敗，請重試。');
  }
  const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const now = Date.now();
  const saved = await saveLauncherText(c.env.DB_IDENTITY, appId, { name: text('name'), web: text('web'), play: text('play'), appstore: text('appstore'), summary: text('summary') }, actor.userId, now);
  if (!saved.ok) return editPage(c, appId, saved.error);
  const file = body.icon;
  if (file instanceof File && file.size > 0) {
    if (!c.env.AVATARS) return editPage(c, appId, '圖片儲存尚未設定。');
    if (file.size > ICON_MAX_BYTES) return editPage(c, appId, '圖片太大，請選 300 KB 以內的圖片（其他欄位已儲存）。');
    const icon = await saveLauncherIcon(c.env.DB_IDENTITY, c.env.AVATARS, appId, new Uint8Array(await file.arrayBuffer()), actor.userId, now);
    if (!icon.ok) return editPage(c, appId, `${icon.error}（其他欄位已儲存）`);
  }
  await audit(c, actor.userId, 'admin.launcher_saved', appId);
  return editPage(c, appId, '已儲存。');
});

adminApp.post('/launcher/:id/icon-remove', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const appId = c.req.param('id');
  await removeLauncherIcon(c.env.DB_IDENTITY, c.env.AVATARS, appId, actor.userId, Date.now());
  await audit(c, actor.userId, 'admin.launcher_icon_removed', appId);
  return editPage(c, appId, '已移除圖示。');
});

adminApp.post('/launcher/:id/reset', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const appId = c.req.param('id');
  await resetLauncher(c.env.DB_IDENTITY, c.env.AVATARS, appId);
  await audit(c, actor.userId, 'admin.launcher_reset', appId);
  return editPage(c, appId, '已還原為預設。');
});
