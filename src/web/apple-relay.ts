import { Hono } from 'hono';
import { html } from 'hono/html';
import { audiencesFor, getApp } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import type { AppBindings } from '../env';
import { WEB_APP_ID } from '../identity/web-sessions';
import { open as unseal, seal } from '../lib/sealed';
import { page, readForm, webContext, type WebContext } from './layout';

/**
 * Spec S-ID-01: "Android 上的 Apple 登入走網頁流程". Apple has no Android SDK, so an Android App
 * opens /auth/apple/start in a browser tab (expo-web-browser openAuthSessionAsync). Starry sends
 * the browser to Apple with the Services ID; Apple posts the result to /auth/apple/callback;
 * this page hands id_token and code to the App's registered deep link. The App then calls
 * POST /v1/auth/apple with its raw nonce and redirect_uri = <origin>/auth/apple/callback.
 *
 * The App passes the SHA-256 (hex) of its nonce, as the iOS SDK does, so an intercepted deep
 * link is useless without the raw nonce that only the App holds. Apple's callback is a
 * cross-site form POST, so these routes carry no cookie session and need no CSRF check.
 */
export const appleRelay = new Hono<AppBindings>();
appleRelay.use('*', webContext);

const STATE_CONTEXT = 'apple-relay-v1';
const STATE_TTL_MS = 10 * 60 * 1000;
const NONCE_HASH = /^[a-f0-9]{64}$/;
const APP_STATE = /^[A-Za-z0-9._~-]{0,256}$/;

interface RelayState {
  app: string;
  ret: string;
  st: string;
  exp: number;
}

export function relayCallbackUrl(c: WebContext): string {
  return `${new URL(c.req.url).origin}/auth/apple/callback`;
}

function problem(c: WebContext, text: string, status: 400 | 403 | 503 = 400) {
  return c.html(page(c, 'Apple 登入', html`<h1>Apple 登入</h1><div class="banner danger">${text}</div><p class="muted">請回到 App 再試一次。</p>`), status);
}

/** GET /auth/apple/start?app_id&nonce=<sha256 hex>&return=<deep link>&state=<optional> */
appleRelay.get('/start', async (c) => {
  const appId = c.req.query('app_id') ?? '';
  const nonceHash = c.req.query('nonce') ?? '';
  const returnUrl = c.req.query('return') ?? '';
  const appState = c.req.query('state') ?? '';
  const configured = appId === WEB_APP_ID ? undefined : getApp(appId);
  if (!configured || !configured.return_urls.includes(returnUrl)) return problem(c, '這個 App 沒有登記 Apple 網頁登入。');
  if (!NONCE_HASH.test(nonceHash) || !APP_STATE.test(appState)) return problem(c, '登入參數不正確。');
  const app = await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now());
  if (app.status !== 'active') return problem(c, '這個 App 目前無法使用。', 403);
  const web = getApp(WEB_APP_ID);
  const servicesId = web ? audiencesFor(c.env, web, 'apple')[0] : undefined;
  const key = c.env.DATA_ENCRYPTION_KEY;
  if (!servicesId || !key || !audiencesFor(c.env, app, 'apple').includes(servicesId)) return problem(c, 'Apple 網頁登入尚未設定。', 503);
  const state: RelayState = { app: app.app_id, ret: returnUrl, st: appState, exp: Date.now() + STATE_TTL_MS };
  const sealed = await seal(key, STATE_CONTEXT, JSON.stringify(state));
  if (!sealed) return problem(c, 'Apple 網頁登入尚未設定。', 503);
  const authorize = new URL('https://appleid.apple.com/auth/authorize');
  authorize.search = new URLSearchParams({
    client_id: servicesId,
    redirect_uri: relayCallbackUrl(c),
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'email',
    nonce: nonceHash,
    state: sealed,
  }).toString();
  return c.redirect(authorize.toString(), 302);
});

function readState(raw: string | null): RelayState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<RelayState>;
    return typeof s.app === 'string' && typeof s.ret === 'string' && typeof s.st === 'string' && typeof s.exp === 'number' ? (s as RelayState) : null;
  } catch {
    return null;
  }
}

/** POST /auth/apple/callback — Apple's form_post; hands the result to the App's deep link. */
appleRelay.post('/callback', async (c) => {
  const form = await readForm(c);
  const key = c.env.DATA_ENCRYPTION_KEY;
  const state = readState(key && form.state && form.state.length <= 2048 ? await unseal(key, STATE_CONTEXT, form.state) : null);
  // The deep link must still be registered: a config change takes effect immediately.
  if (!state || state.exp <= Date.now() || !getApp(state.app)?.return_urls.includes(state.ret)) return problem(c, '登入逾時，請回到 App 再試一次。');
  const result = new URLSearchParams(
    form.id_token && form.code
      ? { id_token: form.id_token, code: form.code, state: state.st }
      : { error: (form.error ?? 'unknown_error').slice(0, 64), state: state.st },
  );
  const target = `${state.ret}?${result.toString()}`;
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
  const nonce = c.get('cspNonce');
  return c.html(
    page(
      c,
      'Apple 登入',
      html`<h1>${form.id_token ? '登入完成' : '登入未完成'}</h1><p>正在回到 App…</p><p><a class="button" id="back" href="${target}">回到 App</a></p>`,
      { scripts: html`<script nonce="${nonce}">location.replace(document.getElementById('back').href);</script>` },
    ),
  );
});
