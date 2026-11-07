import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { getApp } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import { liveSso, revokeSso, SSO_CODE_TTL_MS, SSO_WEB_CHECK_CONTEXT, SSO_WEB_CODE_CONTEXT } from '../auth/sso';
import { parseRefreshToken } from '../auth/sessions';
import type { AppBindings } from '../env';
import { WEB_APP_ID } from '../identity/web-sessions';
import { auditStatement } from '../lib/audit';
import { open as unseal, seal } from '../lib/sealed';
import { allowedReturn } from './login-relay';
import { page, webContext, type WebContext } from './layout';

/**
 * Web single sign-on across Starry Apps in one browser. id.starry.phd keeps the device sign-on token in a
 * cookie; each web App asks it who is signed in by a top-level redirect (cookies are not sent to cross-site
 * fetches any more), and gets a one-time code back in the URL fragment:
 *
 *   /auth/sso/adopt?c=<code from POST /v1/auth/sso/web-code>&return=<App page>   after an App signs in
 *   /auth/sso/check?app_id&nonce=<sha256 hex>&return=<App page>&state=           ask who is signed in
 *   /auth/sso/logout?app_id&return=<App page>                                    sign out every web App
 *
 * check returns `#sso_code=<code>&sso_user=<user id>&state=` (then POST /v1/auth/sso/web-exchange with the raw
 * nonce) or `#sso_none=1&state=`. Only registered web origins of the App can be returned to.
 */
export const ssoRelay = new Hono<AppBindings>();
ssoRelay.use('*', webContext);

const COOKIE = 'starry_sso';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const NONCE_HASH = /^[a-f0-9]{64}$/;
const APP_STATE = /^[A-Za-z0-9._~-]{0,256}$/;

function problem(c: WebContext, text: string, status: 400 | 403 | 503 = 400) {
  return c.html(page(c, '共用登入', html`<h1>共用登入</h1><div class="banner danger">${text}</div><p class="muted">請回到 App 再試一次。</p>`), status);
}

/** The App and a registered https page of its own web origins, or null. */
async function target(c: WebContext) {
  const appId = c.req.query('app_id') ?? '';
  const ret = c.req.query('return') ?? '';
  const configured = appId === WEB_APP_ID ? undefined : getApp(appId);
  if (!configured || allowedReturn(configured, ret) !== 'web') return null;
  const app = await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now());
  return app.status === 'active' ? { app, ret } : null;
}

function back(c: WebContext, ret: string, fragment: Record<string, string>) {
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
  return c.redirect(`${ret}#${new URLSearchParams(fragment).toString()}`, 302);
}

/** GET /auth/sso/adopt — remembers this browser as signed in (cookie) after a web App signed the member in. */
ssoRelay.get('/adopt', async (c) => {
  const t = await target(c);
  const key = c.env.DATA_ENCRYPTION_KEY;
  if (!t || !key) return problem(c, '這個 App 沒有登記這個回傳網址。');
  const code = c.req.query('c') ?? '';
  const opened = code.length <= 1024 ? await unseal(key, SSO_WEB_CODE_CONTEXT, code) : null;
  let claims: { t?: string; exp?: number } | null;
  try {
    claims = opened ? (JSON.parse(opened) as { t?: string; exp?: number }) : null;
  } catch {
    claims = null;
  }
  const sso = claims && typeof claims.t === 'string' && typeof claims.exp === 'number' && claims.exp > Date.now() ? await liveSso(c.env.DB_IDENTITY, claims.t, Date.now()) : null;
  if (!sso || !claims?.t) return back(c, t.ret, { sso_none: '1', state: '' });
  setCookie(c, COOKIE, claims.t, { prefix: 'host', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: COOKIE_MAX_AGE });
  return back(c, t.ret, { sso_adopted: '1', state: '' });
});

/** GET /auth/sso/check — who is signed in in this browser? Answers with a one-time code for this App and nonce. */
ssoRelay.get('/check', async (c) => {
  const t = await target(c);
  const key = c.env.DATA_ENCRYPTION_KEY;
  const nonceHash = c.req.query('nonce') ?? '';
  const state = c.req.query('state') ?? '';
  if (!t || !key || !NONCE_HASH.test(nonceHash) || !APP_STATE.test(state)) return problem(c, '共用登入參數不正確。');
  const token = getCookie(c, COOKIE, 'host');
  const sso = token ? await liveSso(c.env.DB_IDENTITY, token, Date.now()) : null;
  if (!sso || sso.status !== 'active') return back(c, t.ret, { sso_none: '1', state });
  const code = await seal(key, SSO_WEB_CHECK_CONTEXT, JSON.stringify({ sid: sso.sso_id, app: t.app.app_id, nh: nonceHash, exp: Date.now() + SSO_CODE_TTL_MS }));
  return code ? back(c, t.ret, { sso_code: code, sso_user: sso.user_id, state }) : problem(c, '共用登入尚未設定。', 503);
});

/** GET /auth/sso/logout — signs out every Starry App of this browser, then returns to the App. */
ssoRelay.get('/logout', async (c) => {
  const t = await target(c);
  if (!t) return problem(c, '這個 App 沒有登記這個回傳網址。');
  const token = getCookie(c, COOKIE, 'host');
  const parsed = parseRefreshToken(token);
  deleteCookie(c, COOKIE, { prefix: 'host', path: '/', secure: true });
  if (parsed) {
    const db = c.env.DB_IDENTITY;
    const now = Date.now();
    const sso = await liveSso(db, token, now);
    if (sso) {
      await db.batch([
        ...revokeSso(db, sso.sso_id, now, 'sso_logout'),
        auditStatement(db, { actorType: 'user', actorUserId: sso.user_id, action: 'auth.sso_logout', targetType: 'session', targetId: sso.sso_id, appId: t.app.app_id, result: 'success', requestId: c.get('requestId'), retention: 'security' }, now),
      ]);
    }
  }
  return back(c, t.ret, { sso_none: '1', state: '' });
});

