import { setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { WEB_LINK_CONTEXT, type WebLinkPage } from '../auth/web-link';
import type { AppBindings } from '../env';
import { consumeNonce } from '../identity/nonces';
import { createWebSession, WEB_APP_ID, WEB_SESSION_ABSOLUTE_MS } from '../identity/web-sessions';
import { open as unseal } from '../lib/sealed';
import { page, SESSION_COOKIE, webContext, type WebContext } from './layout';
import { webDeviceLabel } from './account-lib';

/**
 * GET /auth/app-open?c=<code from POST /v1/me/web-link> — the App's web view arrives here once. The code is sealed,
 * bound to the member and the App, lasts 2 minutes and works once; it becomes the normal web account session
 * (cookie) and the browser is sent to the member page the App asked for.
 */
export const appOpen = new Hono<AppBindings>();
appOpen.use('*', webContext);

const PAGES: Record<WebLinkPage, string> = {
  card: '/account/card',
  profile: '/account/profile',
  referral: '/account/referral',
  network: '/account/network',
  apps: '/account/apps',
  battery: '/account/battery',
};

interface Claims {
  u?: string;
  sv?: number;
  n?: string;
  to?: string;
  a?: string;
  exp?: number;
}

function refuse(c: WebContext) {
  c.header('cache-control', 'no-store');
  return c.html(page(c, '無法開啟', html`<h1>無法開啟</h1><div class="banner danger">這個連結已過期或已使用過。</div><p class="muted">請回到 App 再開一次。</p>`), 400);
}

/** The path (with the App's id for the card) a valid ticket may land on. */
export function landingPath(claims: Claims): string | null {
  const to = claims.to as WebLinkPage;
  const base = PAGES[to];
  if (!base || typeof claims.a !== 'string') return null;
  if (to !== 'card' && to !== 'battery') return base;
  return `${base}?${new URLSearchParams({ app: claims.a }).toString()}`;
}

appOpen.get('/', async (c) => {
  const key = c.env.DATA_ENCRYPTION_KEY;
  const code = c.req.query('c') ?? '';
  if (!key || code.length === 0 || code.length > 1024) return refuse(c);
  let claims: Claims | null;
  try {
    const opened = await unseal(key, WEB_LINK_CONTEXT, code);
    claims = opened ? (JSON.parse(opened) as Claims) : null;
  } catch {
    claims = null;
  }
  const now = Date.now();
  const landing = claims ? landingPath(claims) : null;
  if (!claims || !landing || typeof claims.u !== 'string' || typeof claims.n !== 'string' || typeof claims.exp !== 'number' || claims.exp <= now) return refuse(c);
  const db = c.env.DB_IDENTITY;
  if (!(await consumeNonce(db, claims.n, WEB_APP_ID, now))) return refuse(c);
  const user = await db.prepare('SELECT status, session_version FROM users WHERE user_id = ?').bind(claims.u).first<{ status: string; session_version: number }>();
  if (!user || user.status !== 'active' || user.session_version !== claims.sv) return refuse(c);
  const session = await createWebSession(db, { userId: claims.u, sessionVersion: user.session_version, provider: 'app', deviceLabel: webDeviceLabel(c), requestId: c.get('requestId') }, now);
  setCookie(c, SESSION_COOKIE, session.cookieValue, { prefix: 'host', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: Math.floor(WEB_SESSION_ABSOLUTE_MS / 1000) });
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
  return c.redirect(landing, 302);
});
