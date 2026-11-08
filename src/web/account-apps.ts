import { appsPageBody } from './app-launcher';
import { page } from './layout';
import { accountApp } from './account-lib';

/** GET /account/apps — the full page behind the 9-dot button: every Starry App. */
accountApp.get('/apps', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/apps', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  return c.html(page(c, '繁星生態系', await appsPageBody(c)));
});
