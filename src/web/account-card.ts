import { html } from 'hono/html';
import { getApp } from '../apps/registry';
import { getBalance } from '../battery/battery';
import { syncBonus } from '../battery/bonus';
import { getQuantum } from '../battery/quantum';
import { initialsOf } from '../identity/initials';
import { listPasskeys } from '../identity/passkeys';
import { shownName } from '../identity/profile';
import { BATTERY_ICON } from '../lib/battery-icons';
import { accountApp, loadAccount } from './account-lib';
import { page } from './layout';
import { avatarBubble } from './member-nav';

/**
 * GET /account/card?app=<app id> — the standard member block at the top of every App's settings page.
 * Apps show it in an in-App web view (opened through POST /v1/me/web-link, so no second sign-in) and add nothing
 * of their own to it, so the picture, name, member number, battery line and Passkey count look and read the same in
 * every App. Changing the wording or order here changes every App at once. Display only: the buttons below it
 * (會員中心, 聯絡客服, 登出, 刪除) are native, in the order the handoff text fixes.
 */
accountApp.get('/card', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/card', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const now = Date.now();
  const requested = c.req.query('app') ?? '';
  const app = requested && requested !== 'account' ? getApp(requested) : undefined;
  const account = await loadAccount(c.env.DB_IDENTITY, web.userId);
  if (!account) return c.redirect('/account', 303);
  const p = account.profile;
  await syncBonus(c.env.DB_BATTERY, web.userId, p, now);
  const [battery, quantum, passkeys] = await Promise.all([
    getBalance(c.env.DB_BATTERY, web.userId, now).catch(() => null),
    app ? getQuantum(c.env.DB_BATTERY, web.userId, app.app_id).catch(() => null) : Promise.resolve(null),
    listPasskeys(c.env.DB_IDENTITY, web.userId),
  ]);
  const name = shownName(p.nickname, p.display_name, p.primary_name) ?? '星友';
  const photo = p.avatar_key ? `/account/avatar-image?v=${encodeURIComponent(p.avatar_key.split('/').pop() ?? '')}` : null;
  const body = html`<div class="cardblock">
  <div class="hero">${avatarBubble({ initials: initialsOf(p.display_name ?? p.nickname), photo, size: 64, label: name })}<div><h1>${name}</h1>${account.memberNo ? html`<span class="badge">${account.memberNo}</span>` : ''}</div></div>
  <p class="cardline"><span>${BATTERY_ICON.normal} <b>${battery ? battery.remaining : '–'}</b></span>${quantum ? html`&emsp;<span>${BATTERY_ICON.quantum} <b>${quantum.available}</b></span>` : ''}&emsp;<span>Passkey <b>${passkeys.length}</b></span></p>
</div>`;
  c.header('cache-control', 'no-store');
  return c.html(page(c, '會員', body, { embed: true }));
});
