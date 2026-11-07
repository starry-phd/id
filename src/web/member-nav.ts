import { html } from 'hono/html';
import { BATTERY_ICON } from '../lib/battery-icons';
import { getBalance } from '../battery/battery';
import { listQuantum } from '../battery/quantum';
import { initialsOf } from '../identity/initials';
import type { Html, WebContext } from './layout';

/** The little round picture: the member's photo, or the first letters of family and given name. */
export function avatarBubble(input: { initials: string; photo: string | null; size?: number; label?: string }): Html {
  const size = input.size ?? 36;
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  return input.photo
    ? html`<img class="avatar" src="${input.photo}" alt="${input.label ?? ''}" width="${size}" height="${size}" style="${style}">`
    : html`<span class="avatar" role="img" aria-label="${input.label ?? ''}" style="${style}">${input.initials}</span>`;
}

/** Path of the public avatar image for a member number (used in trees and public pages). */
export const avatarPath = (memberNo: string): string => `/a/${memberNo}`;

/**
 * The always-visible main menu of the member pages: battery counts, picture and name, About me, Referrals, Network.
 * Empty when nobody is signed in on this browser.
 */
export async function memberNav(c: WebContext): Promise<Html> {
  const web = c.get('web');
  if (!web || web.status !== 'active') return html``;
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const [profile, user, battery, quantum] = await Promise.all([
    db.prepare('SELECT display_name, nickname, avatar_key FROM profiles WHERE user_id = ?').bind(web.userId).first<{ display_name: string | null; nickname: string | null; avatar_key: string | null }>(),
    db.prepare('SELECT member_no FROM users WHERE user_id = ?').bind(web.userId).first<{ member_no: string | null }>(),
    getBalance(c.env.DB_BATTERY, web.userId, now).catch(() => null),
    listQuantum(c.env.DB_BATTERY, web.userId).catch(() => []),
  ]);
  const name = profile?.nickname || profile?.display_name || '我';
  const path = new URL(c.req.url).pathname;
  const on = (href: string) => (path === href || (href !== '/account' && path.startsWith(`${href}/`)) ? ' class="on" aria-current="page"' : '');
  const photo = profile?.avatar_key && user?.member_no ? '/account/avatar-image' : null;
  const quantumTotal = quantum.reduce((sum, q) => sum + q.available, 0);
  return html`<nav class="starnav" aria-label="主選單">
  <a class="stat" href="/account#battery" title="電池">${BATTERY_ICON.normal} <b>${battery ? battery.remaining : '–'}</b></a>
  <a class="stat" href="/account#battery" title="量子電池">${BATTERY_ICON.quantum} <b>${quantumTotal}</b></a>
  <a class="me" href="/account"${on('/account')}>${avatarBubble({ initials: initialsOf(profile?.display_name ?? profile?.nickname), photo, label: name })}<span>${name}</span></a>
  <a href="/account/profile"${on('/account/profile')}>關於我</a>
  <a href="/account/referral"${on('/account/referral')}>推薦達人</a>
  <a href="/account/network"${on('/account/network')}>組織網</a>
</nav>`;
}

