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
  const edit = owner ? html`<p><a class="button secondary" href="/admin/launcher">編輯這個頁面（超級管理員）</a></p>` : '';
  return c.html(page(c, '繁星生態系', html`${await appsPageBody(c)}${edit}`));
});
