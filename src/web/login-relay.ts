import { Hono } from 'hono';
import { html } from 'hono/html';
import { audiencesFor, getApp, type AppEntry } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import type { Provider } from '../auth/provider-keys';
import type { AppBindings } from '../env';
import { WEB_APP_ID } from '../identity/web-sessions';
import { open as unseal, seal } from '../lib/sealed';
import { page, readForm, webContext, type WebContext } from './layout';

/**
 * Starry sign-in relay (spec S-ID-01). Apple and Google are configured once, for id.starry.phd;
 * an App's Android build or web version never needs its own Apple domain or Google origin.
 *
 *   1. The App (Android browser tab, or its web page) opens /auth/{apple|google}/start with
 *      app_id, the SHA-256 (hex) of a nonce from POST /v1/auth/nonce, a return URL and a state.
 *   2. Starry sends the browser to Apple or Google with the account center's Services ID / Web
 *      client; they post the result back to /auth/{provider}/callback.
 *   3. Starry hands id_token (and Apple's code) to the return URL: a registered deep link
 *      (query string) or a page on one of the App's registered web origins (URL fragment, so
 *      it never reaches a server).
 *   4. The App calls POST /v1/auth/{provider} with the raw nonce (and, for Apple, the code and
 *      redirect_uri = <origin>/auth/apple/callback).
 *
 * Only the nonce hash travels, so whoever intercepts the return URL cannot sign in. Callbacks
 * are cross-site form posts from Apple/Google: no cookie session, no CSRF check needed.
 */
export const loginRelay = new Hono<AppBindings>();
loginRelay.use('*', webContext);

const STATE_CONTEXT = 'login-relay-v1';
const STATE_TTL_MS = 10 * 60 * 1000;
const NONCE_HASH = /^[a-f0-9]{64}$/;
const APP_STATE = /^[A-Za-z0-9._~-]{0,256}$/;
const NAMES: Record<Provider, string> = { apple: 'Apple', google: 'Google' };

interface RelayState {
  app: string;
  p: Provider;
  ret: string;
  st: string;
  exp: number;
}

function providerOf(value: string): Provider | null {
  return value === 'apple' || value === 'google' ? value : null;
}

export function relayCallbackUrl(c: WebContext, provider: Provider): string {
  return `${new URL(c.req.url).origin}/auth/${provider}/callback`;
}

/** A registered deep link, or an https page on one of the App's registered web origins. */
export function allowedReturn(app: AppEntry, value: string): 'deep_link' | 'web' | null {
  if (app.return_urls.includes(value)) return 'deep_link';
  if (value.length > 300) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.hash === '' && url.username === '' && app.web_origins.includes(url.origin) ? 'web' : null;
}

function problem(c: WebContext, title: string, text: string, status: 400 | 403 | 503 = 400) {
  return c.html(page(c, title, html`<h1>${title}</h1><div class="banner danger">${text}</div><p class="muted">請回到 App 再試一次。</p>`), status);
}

/** The account center's client for this provider, if the App also accepts it as an audience. */
function relayClient(c: WebContext, app: AppEntry, provider: Provider): string | null {
  const web = getApp(WEB_APP_ID);
  const client = web ? audiencesFor(c.env, web, provider)[0] : undefined;
  return client && audiencesFor(c.env, app, provider).includes(client) ? client : null;
}

/** GET /auth/{apple|google}/start?app_id&nonce=<sha256 hex>&return=<URL>&state=<optional> */
loginRelay.get('/:provider/start', async (c) => {
  const provider = providerOf(c.req.param('provider'));
  if (!provider) return c.notFound();
  const title = `${NAMES[provider]} 登入`;
  const appId = c.req.query('app_id') ?? '';
  const nonceHash = c.req.query('nonce') ?? '';
  const returnUrl = c.req.query('return') ?? '';
  const appState = c.req.query('state') ?? '';
  const configured = appId === WEB_APP_ID ? undefined : getApp(appId);
  if (!configured || !allowedReturn(configured, returnUrl)) return problem(c, title, '這個 App 沒有登記這個登入回傳網址。');
  if (!NONCE_HASH.test(nonceHash) || !APP_STATE.test(appState)) return problem(c, title, '登入參數不正確。');
  const app = await withEffectiveStatus(c.env.DB_IDENTITY, configured, Date.now());
  if (app.status !== 'active') return problem(c, title, '這個 App 目前無法使用。', 403);
  const client = relayClient(c, app, provider);
  const key = c.env.DATA_ENCRYPTION_KEY;
  if (!client || !key) return problem(c, title, `${NAMES[provider]} 登入尚未設定。`, 503);
  const state: RelayState = { app: app.app_id, p: provider, ret: returnUrl, st: appState, exp: Date.now() + STATE_TTL_MS };
  const sealed = await seal(key, STATE_CONTEXT, JSON.stringify(state));
  if (!sealed) return problem(c, title, `${NAMES[provider]} 登入尚未設定。`, 503);
  const common = { client_id: client, redirect_uri: relayCallbackUrl(c, provider), response_mode: 'form_post', nonce: nonceHash, state: sealed };
  const authorize =
    provider === 'apple'
      ? new URL(`https://appleid.apple.com/auth/authorize?${new URLSearchParams({ ...common, response_type: 'code id_token', scope: 'email' })}`)
      : new URL(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ ...common, response_type: 'id_token', scope: 'openid email profile', prompt: 'select_account' })}`);
  return c.redirect(authorize.toString(), 302);
});

function readState(raw: string | null): RelayState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<RelayState>;
    const ok = typeof s.app === 'string' && providerOf(s.p ?? '') !== null && typeof s.ret === 'string' && typeof s.st === 'string' && typeof s.exp === 'number';
    return ok ? (s as RelayState) : null;
  } catch {
    return null;
  }
}

/** POST /auth/{apple|google}/callback — the provider's form_post; hands the result to the App. */
loginRelay.post('/:provider/callback', async (c) => {
  const provider = providerOf(c.req.param('provider'));
  if (!provider) return c.notFound();
  const title = `${NAMES[provider]} 登入`;
  const form = await readForm(c);
  const key = c.env.DATA_ENCRYPTION_KEY;
  const state = readState(key && form.state && form.state.length <= 2048 ? await unseal(key, STATE_CONTEXT, form.state) : null);
  const app = state ? getApp(state.app) : undefined;
  // The return URL must still be registered: a configuration change takes effect at once.
  const kind = state && app && state.p === provider ? allowedReturn(app, state.ret) : null;
  if (!state || !kind || state.exp <= Date.now()) return problem(c, title, '登入逾時，請回到 App 再試一次。');
  const signedIn = Boolean(form.id_token) && (provider === 'google' || Boolean(form.code));
  const result = new URLSearchParams(
    signedIn
      ? { id_token: form.id_token ?? '', ...(provider === 'apple' ? { code: form.code ?? '' } : {}), state: state.st }
      : { error: (form.error ?? 'unknown_error').slice(0, 64), state: state.st },
  );
  const target = `${state.ret}${kind === 'web' ? '#' : '?'}${result.toString()}`;
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
  const nonce = c.get('cspNonce');
  return c.html(
    page(
      c,
      title,
      html`<h1>${signedIn ? '登入完成' : '登入未完成'}</h1><p>正在回到 App…</p><p><a class="button" id="back" href="${target}">回到 App</a></p>`,
      { scripts: html`<script nonce="${nonce}">location.replace(document.getElementById('back').href);</script>` },
    ),
  );
});
