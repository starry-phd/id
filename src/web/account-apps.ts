import { appsPageBody } from './app-launcher';
import { html } from 'hono/html';
import { hasRole, roleOf } from '../identity/roles';
import { page } from './layout';
import { accountApp } from './account-lib';

/** GET /account/apps — the full page behind the 9-dot button: every Starry App. */
accountApp.get('/apps', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/apps', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const owner = hasRole(await roleOf(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, web.userId), 'owner');
  const session = html`<style>.apps-session{display:flex;gap:10px;margin:0 0 14px}.apps-session form{flex:1;margin:0}.apps-session button{width:100%;margin:0}</style>
<div class="apps-session"><form method="post" action="/account/logout"><button class="secondary" type="submit">登出</button></form><form method="post" action="/account/logout"><input type="hidden" name="next" value="/account/apps"><button class="secondary" type="submit">切換帳號</button></form></div>`;
  const edit = owner ? html`<p><a class="button secondary" href="/admin/launcher">編輯這個頁面（超級管理員）</a></p>` : '';
  return c.html(page(c, '繁星生態系', html`${session}${await appsPageBody(c)}${edit}`));
});
