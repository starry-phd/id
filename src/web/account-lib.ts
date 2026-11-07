import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import { audiencesFor, getApp, type AppEntry } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import type { Provider } from '../auth/provider-keys';
import { background, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { importProviderAvatar, r2Store, rememberProviderPhoto } from '../identity/avatars';
import { findOrCreateMember, PROFILE_SQL, type ProfileRow } from '../identity/members';
import { issueNonce } from '../identity/nonces';
import { createWebSession, endWebSession, WEB_APP_ID, WEB_SESSION_ABSOLUTE_MS } from '../identity/web-sessions';
import { errorBody } from '../lib/errors';
import { readJsonObject } from '../lib/validate';
import { page, readForm, sameOrigin, SESSION_COOKIE, webContext, type Html, type WebContext } from './layout';
import { PRIVACY_POLICY, TERMS_OF_SERVICE, type LegalDocument } from './legal';

/** Spec S-WEB-01: web account center at /account (sign-in, profile, consent, deletion). */
export const accountApp = new Hono<AppBindings>();
accountApp.use('*', webContext, sameOrigin);

/**
 * /privacy and /terms: public pages each App's store listing links to. Mounted at "/",
 * so middleware is attached per route; a "*" middleware here would also run for /v1.
 */
export const publicPages = new Hono<AppBindings>();

export const LOCALES: Record<string, string> = { 'zh-TW': '繁體中文（台灣）', 'en-US': 'English (US)', 'ja-JP': '日本語' };

function renderLegal(c: WebContext, doc: LegalDocument, version: string): Html {
  return page(
    c,
    doc.title,
    html`<h1>${doc.title}</h1>
<p class="muted">版本：${version}${version.startsWith('draft') ? '（草案，尚未正式生效）' : ''}</p>
<p>${doc.intro}</p>
${doc.sections.map(
  (s) => html`<h2>${s.title}</h2>${(s.paragraphs ?? []).map((p) => html`<p>${p}</p>`)}${s.items ? html`<ul>${s.items.map((i) => html`<li>${i}</li>`)}</ul>` : ''}`,
)}`,
  );
}

publicPages.get('/privacy', webContext, (c) => c.html(renderLegal(c, PRIVACY_POLICY, c.env.PRIVACY_VERSION)));
publicPages.get('/terms', webContext, (c) => c.html(renderLegal(c, TERMS_OF_SERVICE, c.env.TERMS_VERSION)));
publicPages.get('/', (c) => c.redirect('/account', 302));

export async function webApp(c: WebContext): Promise<AppEntry | null> {
  const app = getApp(WEB_APP_ID);
  if (!app) return null;
  const effective = await withEffectiveStatus(c.env.DB_IDENTITY, app, Date.now());
  return effective.status === 'active' ? effective : null;
}

function safeNext(value: string | undefined): string {
  return value && /^\/(account|admin)(\/[A-Za-z0-9/_-]*)?$/.test(value) ? value : '/account';
}

interface ProviderWidgetConfig {
  nonce: string;
  /** Where the page posts { provider, id_token, nonce, authorization_code }. */
  endpoint: '/account/session' | '/account/link';
  /** Where to go after a successful response. */
  next: string;
  google: string | null;
  apple: string | null;
}

/**
 * Google Identity Services and Sign in with Apple JS buttons. Both return an ID token bound to
 * the server nonce; Apple also returns a one-time authorization code, which the server exchanges
 * for a refresh token so it can revoke Apple access when the account is deleted (S-ID-06).
 */
export function providerWidgets(c: WebContext, cfg: ProviderWidgetConfig, appleLabel: string): { body: Html; scripts: Html } {
  const cspNonce = c.get('cspNonce');
  const config = JSON.stringify(cfg);
  const body = html`${cfg.google ? html`<div id="google-button"></div>` : ''}
  ${cfg.apple ? html`<button id="apple-button" type="button" style="background:#000;border-color:#000">${appleLabel}</button>` : ''}
  <p id="login-error" class="danger" role="alert"></p>
  ${cfg.endpoint === '/account/link' ? html`<div id="merge-offer"></div>` : ''}`;
  const scripts = html`${cfg.google ? html`<script src="https://accounts.google.com/gsi/client" async nonce="${cspNonce}"></script>` : ''}
${cfg.apple ? html`<script src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/zh_TW/appleid.auth.js" async nonce="${cspNonce}"></script>` : ''}
<script nonce="${cspNonce}">
const cfg = ${raw(config.replace(/</g, '\\u003c'))};
const fail = (text) => { document.getElementById('login-error').textContent = text; };
const MESSAGES = {
  ACCOUNT_SUSPENDED: '此帳號已停權，請聯絡客服。',
  IDENTITY_IN_USE: '這個登入帳號已屬於另一位 Starry 會員，無法加綁。',
  PROVIDER_ALREADY_LINKED: '您的 Starry 帳號已經綁定這種登入方式。',
  REAUTH_REQUIRED: '為了安全，請重新登入後再操作。',
  CONFLICT: '帳號狀態已改變，請重新整理頁面後再試一次。',
};
const MERGE_BLOCKED = {
  already_has_provider: '您的帳號已經綁定另一個同類型的登入帳號，無法再加綁。',
  staff: '這個登入帳號屬於管理人員帳號，無法合併。',
  suspended: '用這個登入建立的帳號已被停權，無法合併，請聯絡客服。',
  other_sign_in: '用這個登入建立的帳號還綁定了其他登入方式，請聯絡客服協助合併。',
  purchases: '用這個登入建立的帳號有購買紀錄，為保護您的購買，請聯絡客服協助合併。',
};
const explain = (body, fallback) => (body && body.merge_blocked && MERGE_BLOCKED[body.merge_blocked]) || MESSAGES[body?.error?.code] || fallback;
function offerMerge(m) {
  const box = document.getElementById('merge-offer');
  if (!box) return;
  const name = m.provider === 'apple' ? 'Apple' : 'Google';
  const when = new Date(m.created_at).toLocaleDateString('zh-TW');
  const question = document.createElement('p');
  question.textContent = '這個 ' + name + ' 帳號在 ' + when + ' 已經建立了另一個 Starry 帳號' + (m.display_name ? '「' + m.display_name + '」' : '') + '。要把它合併到目前這個帳號嗎？';
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = '合併後只保留目前這個帳號，之後用 Apple 或 Google 都會登入這裡。另一個帳號的客服紀錄會移過來；它的個人資料、同意紀錄與 Battery 使用紀錄會刪除（已購買的量子電池會移到這個帳號），用它登入的裝置會被登出。';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '合併帳號';
  button.addEventListener('click', async () => {
    button.disabled = true;
    const res = await fetch(cfg.endpoint + '/merge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: m.ticket }) });
    if (res.ok) { location.href = '/account?notice=merged'; return; }
    button.disabled = false;
    fail(explain(await res.json().catch(() => ({})), '合併失敗，請重新整理頁面後再試一次。'));
  });
  box.replaceChildren(question, note, button);
  fail('');
}
async function send(provider, idToken, code) {
  const payload = { provider, id_token: idToken, nonce: cfg.nonce };
  if (code) payload.authorization_code = code;
  const res = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.ok) { location.href = cfg.next; return; }
  const body = await res.json().catch(() => ({}));
  if (body && body.merge) { offerMerge(body.merge); return; }
  fail(explain(body, '操作失敗，請重新整理頁面後再試一次。'));
}
window.addEventListener('load', () => {
  if (cfg.google && window.google?.accounts?.id) {
    google.accounts.id.initialize({ client_id: cfg.google, nonce: cfg.nonce, callback: (r) => send('google', r.credential), ux_mode: 'popup' });
    google.accounts.id.renderButton(document.getElementById('google-button'), { theme: 'outline', size: 'large', text: cfg.endpoint === '/account/link' ? 'continue_with' : 'signin_with', locale: 'zh-TW' });
  }
  if (cfg.apple && window.AppleID) {
    AppleID.auth.init({ clientId: cfg.apple, scope: 'email', redirectURI: location.origin + '/account', nonce: cfg.nonce, usePopup: true });
    document.getElementById('apple-button').addEventListener('click', async () => {
      try { const r = await AppleID.auth.signIn(); await send('apple', r.authorization.id_token, r.authorization.code); } catch { fail('Apple 登入已取消或失敗。'); }
    });
  }
});
</script>`;
  return { body, scripts };
}

/** The redirect URI the web Apple flow registers (Services ID Return URL). */
export function appleRedirectUri(c: WebContext): string {
  return `${new URL(c.req.url).origin}/account`;
}

/** Browser side of passkeys: talks to /account/passkey/* with navigator.credentials. */
export function passkeyScript(c: WebContext, mode: 'register' | 'login', next = '/account'): Html {
  const cspNonce = c.get('cspNonce');
  const target = mode === 'register' ? '#add-passkey' : '#passkey-login';
  return html`<script nonce="${cspNonce}">
(function () {
  const button = document.querySelector('${raw(target)}');
  if (!button) return;
  if (!window.PublicKeyCredential || !navigator.credentials) { button.style.display = 'none'; return; }
  const out = document.getElementById('passkey-error');
  const say = (t) => { if (out) out.textContent = t; };
  // No backslashes here: this text lives inside a TypeScript template literal.
  const b2u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).split('+').join('-').split('/').join('_').split('=').join('');
  const u2b = (s) => Uint8Array.from(atob(s.split('-').join('+').split('_').join('/')), (ch) => ch.charCodeAt(0));
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  button.addEventListener('click', async () => {
    button.disabled = true; say('');
    try {
      ${mode === 'register'
        ? raw(`const o = await post('/account/passkey/register-options');
      if (o.status === 403) { say('為了安全，請重新登入後再新增 Passkey。'); return; }
      if (!o.ok) { say('現在無法新增，請稍後再試。'); return; }
      const opts = (await o.json()).publicKey;
      opts.challenge = u2b(opts.challenge); opts.user.id = u2b(opts.user.id);
      opts.excludeCredentials = opts.excludeCredentials.map((k) => ({ ...k, id: u2b(k.id) }));
      const cred = await navigator.credentials.create({ publicKey: opts });
      const r = await post('/account/passkey/register', { name: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'Passkey', clientDataJSON: b2u(cred.response.clientDataJSON), attestationObject: b2u(cred.response.attestationObject) });
      if (r.ok) { location.href = '/account?notice=passkey_added'; return; }
      say(r.status === 409 ? '這個 Passkey 已經新增過，或已達數量上限。' : '新增失敗，請再試一次。');`)
        : raw(`const o = await post('/account/passkey/login-options');
      const opts = (await o.json()).publicKey;
      opts.challenge = u2b(opts.challenge);
      const cred = await navigator.credentials.get({ publicKey: opts });
      const r = await post('/account/passkey/login', { id: cred.id, clientDataJSON: b2u(cred.response.clientDataJSON), authenticatorData: b2u(cred.response.authenticatorData), signature: b2u(cred.response.signature) });
      if (r.ok) { location.href = ${JSON.stringify(next).replace(/</g, '\\u003c')}; return; }
      say(r.status === 403 ? '此帳號已停權，請聯絡客服。' : '登入失敗。請確認這個裝置已新增過 Passkey，或改用 Apple／Google 登入。');`)}
    } catch (e) {
      if (!(e && e.name === 'NotAllowedError')) say('操作失敗，請再試一次。');
    } finally {
      button.disabled = false;
    }
  });
})();
</script>`;
}

export async function loginPage(c: WebContext, message?: string, tone: 'danger' | 'info' = 'danger'): Promise<Response> {
  const app = await webApp(c);
  const googleClient = app ? audiencesFor(c.env, app, 'google')[0] : undefined;
  const appleClient = app ? audiencesFor(c.env, app, 'apple')[0] : undefined;
  const next = safeNext(c.req.query('next'));
  if (!app || (!googleClient && !appleClient)) {
    return c.html(page(c, '登入', html`<h1>登入 Starry</h1><div class="banner">網頁登入尚未開放。請在繁星 App 內登入與管理帳號；如需協助請使用<a href="/support">客服表單</a>。</div>`));
  }
  const nonce = await issueNonce(c.env.DB_IDENTITY, WEB_APP_ID, Date.now());
  const widgets = providerWidgets(c, { nonce, endpoint: '/account/session', next, google: googleClient ?? null, apple: appleClient ?? null }, '使用 Apple 登入');
  const body = html`<h1>登入 Starry</h1>
<p>使用您在繁星 App 中使用的 Apple 或 Google 帳號登入。</p>
${message ? html`<div class="banner${tone === 'danger' ? ' danger' : ''}">${message}</div>` : ''}
<div class="card">
  ${widgets.body}
  <button id="passkey-login" type="button" class="secondary">使用 Passkey 登入</button>
  <p id="passkey-error" class="danger" role="alert"></p>
</div>
<p class="muted">登入即表示您同意<a href="/terms">服務條款</a>與<a href="/privacy">隱私權政策</a>。</p>`;
  return c.html(page(c, '登入', body, { scripts: html`${widgets.scripts}${passkeyScript(c, 'login', next)}` }));
}

/** POST /account/session — the page's script sends the provider ID token here. */
accountApp.post('/session', async (c) => {
  const requestId = c.get('requestId');
  const body = await readJsonObject(c);
  const requested = body?.provider;
  const provider: Provider | null = requested === 'apple' || requested === 'google' ? requested : null;
  const request = readProviderRequest(body);
  if (!provider || !request) return c.json(errorBody('BAD_REQUEST', 'provider, id_token and nonce are required', requestId), 400);
  const app = await webApp(c);
  if (!app) return c.json(errorBody('APP_UNAVAILABLE', 'Web sign-in is not available', requestId), 403);
  const verified = await verifyProviderRequest(c, provider, app, request, `web.login.${provider}`, null);
  if (!verified.ok) return verified.response;
  const now = Date.now();
  const db = c.env.DB_IDENTITY;
  const { member, isNew } = await findOrCreateMember(db, verified.identity, { appId: WEB_APP_ID, requestId, country: c.req.header('cf-ipcountry') }, now);
  if (member.status === 'suspended') return c.json(errorBody('ACCOUNT_SUSPENDED', 'Account suspended', requestId), 403);
  await rememberProviderPhoto(db, verified.identity.subject, verified.identity.picture);
  if (isNew && verified.identity.picture && c.env.AVATARS) {
    const photo = background(c, importProviderAvatar(db, r2Store(c.env.AVATARS), (url, init) => fetch(url, init), { userId: member.user_id, url: verified.identity.picture, appId: WEB_APP_ID, requestId }, now));
    if (photo) await photo;
  }
  if (provider === 'apple' && request.authorizationCode) {
    const pending = background(
      c,
      rememberAppleToken(db, c.env, (url, init) => fetch(url, init), { userId: member.user_id, subject: verified.identity.subject, clientId: verified.identity.audience, code: request.authorizationCode, redirectUri: appleRedirectUri(c), appId: WEB_APP_ID, requestId }, now),
    );
    if (pending) await pending;
  }
  const session = await createWebSession(db, { userId: member.user_id, sessionVersion: member.session_version, provider, deviceLabel: webDeviceLabel(c), requestId }, now);
  setCookie(c, SESSION_COOKIE, session.cookieValue, { prefix: 'host', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: Math.floor(WEB_SESSION_ABSOLUTE_MS / 1000) });
  return c.json({ ok: true });
});

accountApp.post('/logout', async (c) => {
  const web = c.get('web');
  if (web) await endWebSession(c.env.DB_IDENTITY, { sessionId: web.sessionId, userId: web.userId, requestId: c.get('requestId') }, Date.now());
  deleteCookie(c, SESSION_COOKIE, { prefix: 'host', path: '/', secure: true });
  const next = (await readForm(c)).next;
  return c.redirect(next ? `/account?next=${encodeURIComponent(safeNext(next))}` : '/account', 303);
});

/** Short, non-identifying label for a web session, e.g. "網頁：iOS Safari". */
export function webDeviceLabel(c: WebContext): string {
  const ua = c.req.header('user-agent') ?? '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const detail = [os, browser].filter((part) => part !== '').join(' ');
  return detail ? `網頁：${detail}` : '網頁';
}

export const NOTICES: Record<string, string> = {
  linked: '已加綁新的登入方式。',
  session_revoked: '已登出該裝置。',
  passkey_added: 'Passkey 已新增，下次可以直接用它登入。',
  passkey_removed: 'Passkey 已移除。',
  logged_out_everywhere: '已登出所有裝置與 App。',
  merged: '已合併帳號。現在用 Apple 或 Google 都會登入這個帳號。',
};

export function appLabel(appId: string): string {
  if (appId === WEB_APP_ID) return 'Starry 帳號中心（網頁）';
  return getApp(appId)?.name ?? appId;
}

/** Providers the web account center can link that this member does not have yet. */
export function linkableProviders(c: WebContext, app: AppEntry, linked: readonly string[]): { google: string | null; apple: string | null } {
  const pick = (provider: Provider) => (linked.includes(provider) ? null : (audiencesFor(c.env, app, provider)[0] ?? null));
  return { google: pick('google'), apple: pick('apple') };
}

interface AccountView {
  createdAt: number;
  memberNo: string | null;
  deletionRequestedAt: number | null;
  profile: ProfileRow;
  identities: { provider: string; email: string | null }[];
}

export async function loadAccount(db: D1Database, userId: string): Promise<AccountView | null> {
  const [user, profile, identities] = await db.batch([
    db.prepare('SELECT created_at, deletion_requested_at, member_no FROM users WHERE user_id = ?').bind(userId),
    db.prepare(PROFILE_SQL).bind(userId),
    db.prepare('SELECT provider, email FROM auth_identities WHERE user_id = ? ORDER BY provider').bind(userId),
  ]);
  const u = user?.results[0] as { created_at: number; deletion_requested_at: number | null; member_no: string | null } | undefined;
  const p = profile?.results[0] as ProfileRow | undefined;
  if (!u || !p) return null;
  return { createdAt: u.created_at, memberNo: u.member_no, deletionRequestedAt: u.deletion_requested_at, profile: p, identities: (identities?.results ?? []) as AccountView['identities'] };
}

export const PROVIDER_NAMES: Record<string, string> = { apple: 'Apple', google: 'Google' };
