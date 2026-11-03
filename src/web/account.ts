import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import { audiencesFor, getApp, type AppEntry } from '../apps/registry';
import { withEffectiveStatus } from '../apps/status';
import type { Provider } from '../auth/provider-keys';
import { background, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { listActiveSessions, logoutEverywhere, revokeOwnSession } from '../identity/devices';
import { cancelDeletion, DELETION_GRACE_MS, requestDeletion } from '../identity/lifecycle';
import { linkIdentity, type LinkResult } from '../identity/link';
import { acceptConsents, consentRequired, findOrCreateMember, PROFILE_SQL, updateProfile, type ProfileChanges, type ProfileRow } from '../identity/members';
import { issueNonce } from '../identity/nonces';
import { claimOwner, hasRole, isRecentLogin, roleOf } from '../identity/roles';
import { createWebSession, endWebSession, WEB_APP_ID, WEB_SESSION_ABSOLUTE_MS } from '../identity/web-sessions';
import { errorBody } from '../lib/errors';
import { boundedString, isBirthday, isLocale, readJsonObject } from '../lib/validate';
import { formatTime, page, readForm, sameOrigin, SESSION_COOKIE, webContext, type Html, type WebContext } from './layout';
import { PRIVACY_POLICY, TERMS_OF_SERVICE, type LegalDocument } from './legal';

/** Spec S-WEB-01: web account center at /account (sign-in, profile, consent, deletion). */
export const accountApp = new Hono<AppBindings>();
accountApp.use('*', webContext, sameOrigin);

/**
 * /privacy and /terms: public pages each App's store listing links to. Mounted at "/",
 * so middleware is attached per route; a "*" middleware here would also run for /v1.
 */
export const publicPages = new Hono<AppBindings>();

const LOCALES: Record<string, string> = { 'zh-TW': '繁體中文（台灣）', 'en-US': 'English (US)', 'ja-JP': '日本語' };

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

async function webApp(c: WebContext): Promise<AppEntry | null> {
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
function providerWidgets(c: WebContext, cfg: ProviderWidgetConfig, appleLabel: string): { body: Html; scripts: Html } {
  const cspNonce = c.get('cspNonce');
  const config = JSON.stringify(cfg);
  const body = html`${cfg.google ? html`<div id="google-button"></div>` : ''}
  ${cfg.apple ? html`<button id="apple-button" type="button" style="background:#000;border-color:#000">${appleLabel}</button>` : ''}
  <p id="login-error" class="danger" role="alert"></p>`;
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
};
async function send(provider, idToken, code) {
  const payload = { provider, id_token: idToken, nonce: cfg.nonce };
  if (code) payload.authorization_code = code;
  const res = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.ok) { location.href = cfg.next; return; }
  const body = await res.json().catch(() => ({}));
  fail(MESSAGES[body?.error?.code] ?? '操作失敗，請重新整理頁面後再試一次。');
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
function appleRedirectUri(c: WebContext): string {
  return `${new URL(c.req.url).origin}/account`;
}

async function loginPage(c: WebContext, message?: string, tone: 'danger' | 'info' = 'danger'): Promise<Response> {
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
</div>
<p class="muted">登入即表示您同意<a href="/terms">服務條款</a>與<a href="/privacy">隱私權政策</a>。</p>`;
  return c.html(page(c, '登入', body, { scripts: widgets.scripts }));
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
  const { member } = await findOrCreateMember(db, verified.identity, { appId: WEB_APP_ID, requestId }, now);
  if (member.status === 'suspended') return c.json(errorBody('ACCOUNT_SUSPENDED', 'Account suspended', requestId), 403);
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
function webDeviceLabel(c: WebContext): string {
  const ua = c.req.header('user-agent') ?? '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const detail = [os, browser].filter((part) => part !== '').join(' ');
  return detail ? `網頁：${detail}` : '網頁';
}

const NOTICES: Record<string, string> = {
  linked: '已加綁新的登入方式。',
  session_revoked: '已登出該裝置。',
  logged_out_everywhere: '已登出所有裝置與 App。',
};

function appLabel(appId: string): string {
  if (appId === WEB_APP_ID) return 'Starry 帳號中心（網頁）';
  return getApp(appId)?.name ?? appId;
}

/** Providers the web account center can link that this member does not have yet. */
function linkableProviders(c: WebContext, app: AppEntry, linked: readonly string[]): { google: string | null; apple: string | null } {
  const pick = (provider: Provider) => (linked.includes(provider) ? null : (audiencesFor(c.env, app, provider)[0] ?? null));
  return { google: pick('google'), apple: pick('apple') };
}

interface AccountView {
  createdAt: number;
  deletionRequestedAt: number | null;
  profile: ProfileRow;
  identities: { provider: string; email: string | null }[];
}

async function loadAccount(db: D1Database, userId: string): Promise<AccountView | null> {
  const [user, profile, identities] = await db.batch([
    db.prepare('SELECT created_at, deletion_requested_at FROM users WHERE user_id = ?').bind(userId),
    db.prepare(PROFILE_SQL).bind(userId),
    db.prepare('SELECT provider, email FROM auth_identities WHERE user_id = ? ORDER BY provider').bind(userId),
  ]);
  const u = user?.results[0] as { created_at: number; deletion_requested_at: number | null } | undefined;
  const p = profile?.results[0] as ProfileRow | undefined;
  if (!u || !p) return null;
  return { createdAt: u.created_at, deletionRequestedAt: u.deletion_requested_at, profile: p, identities: (identities?.results ?? []) as AccountView['identities'] };
}

const PROVIDER_NAMES: Record<string, string> = { apple: 'Apple', google: 'Google' };

accountApp.get('/', async (c) => {
  const web = c.get('web');
  const notice = NOTICES[c.req.query('notice') ?? ''];
  if (!web) return notice ? loginPage(c, notice, 'info') : loginPage(c);
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const account = await loadAccount(db, web.userId);
  if (!account) return loginPage(c, '找不到此帳號，請重新登入。');
  const needsConsent = await consentRequired(db, web.userId, c.env.TERMS_VERSION, c.env.PRIVACY_VERSION);
  const role = await roleOf(db, c.env.OWNER_USER_IDS, web.userId);
  const p = account.profile;
  const pending = web.status === 'pending_deletion' && account.deletionRequestedAt !== null;
  const app = await webApp(c);
  const linkable = app && !pending ? linkableProviders(c, app, account.identities.map((i) => i.provider)) : { google: null, apple: null };
  const sessions = pending ? [] : await listActiveSessions(db, web.userId, now);
  const body = html`<h1>${p.display_name ?? '我的帳號'}</h1>
${notice ? html`<div class="banner">${notice}</div>` : ''}
${pending
  ? html`<div class="banner danger"><strong>帳號將於 ${formatTime((account.deletionRequestedAt ?? 0) + DELETION_GRACE_MS)} 永久刪除。</strong><br>在此之前可以撤回，撤回後帳號立即恢復。
<form method="post" action="/account/delete/cancel"><button type="submit">撤回刪除申請</button></form></div>`
  : ''}
${!pending && needsConsent
  ? html`<div class="banner"><strong>請確認服務條款與隱私權政策</strong><br>請閱讀<a href="/terms">服務條款</a>與<a href="/privacy">隱私權政策</a>（版本 ${c.env.TERMS_VERSION}／${c.env.PRIVACY_VERSION}）。
<form method="post" action="/account/consent"><button type="submit">我已閱讀並同意</button></form></div>`
  : ''}
<div class="card">
  <p><strong>顯示名稱：</strong>${p.display_name ?? '（未設定）'}<br>
  <strong>生日：</strong>${p.birthday ?? '（未設定）'}<br>
  <strong>語系：</strong>${LOCALES[p.locale] ?? p.locale}<br>
  <span class="muted">加入時間：${formatTime(account.createdAt)}</span></p>
  ${pending ? '' : html`<a class="button" href="/account/profile">編輯個人資料</a>`}
</div>
<h2>登入方式</h2>
<div class="card">
  <ul>${account.identities.map((i) => html`<li>${PROVIDER_NAMES[i.provider] ?? i.provider}${i.email ? html`：${i.email}` : ''}</li>`)}</ul>
  <p class="muted">Email 由登入服務提供，只用於聯絡，無法在此修改。</p>
  ${linkable.google || linkable.apple ? html`<a class="button" href="/account/link">加綁${linkable.apple && linkable.google ? '其他' : linkable.apple ? ' Apple ' : ' Google '}登入方式</a>` : ''}
</div>
${pending
  ? ''
  : html`<h2>登入中的裝置</h2>
<div class="card">
  <table>
    <tr><th>App</th><th>裝置</th><th>最後使用</th><th></th></tr>
    ${sessions.map(
      (s) => html`<tr><td>${appLabel(s.appId)}</td><td>${s.deviceLabel ?? '—'}</td><td>${formatTime(s.lastUsedAt)}</td><td>${s.sessionId === web.sessionId
        ? html`<span class="muted">目前這個瀏覽器</span>`
        : html`<form class="inline" method="post" action="/account/sessions/${s.sessionId}/revoke"><button class="secondary" type="submit">登出</button></form>`}</td></tr>`,
    )}
  </table>
  <form method="post" action="/account/logout-all"><button class="secondary" type="submit">登出所有裝置</button></form>
  <p class="muted">「登出所有裝置」會讓所有繁星 App 與網頁立即登出，包括目前這個瀏覽器。手機遺失時請使用。</p>
</div>`}
${role && hasRole(role, 'support') ? html`<p><a class="button" href="/admin">進入 Admin Lite</a></p>` : ''}
${pending ? '' : html`<h2>刪除帳號</h2><p class="muted">刪除後 7 天內可撤回，期滿永久清除個人資料。</p><a href="/account/delete">申請刪除帳號</a>`}`;
  return c.html(page(c, '我的帳號', body));
});

/** POST /account/sessions/:id/revoke — ends one of the member's other sessions (S-ID-05). */
accountApp.post('/sessions/:id/revoke', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const sessionId = c.req.param('id');
  if (sessionId === web.sessionId) return c.redirect('/account', 303);
  const revoked = await revokeOwnSession(c.env.DB_IDENTITY, { userId: web.userId, sessionId, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  return c.redirect(revoked ? '/account?notice=session_revoked' : '/account', 303);
});

/** POST /account/logout-all — ends every session in every Starry App, including this one (S-ID-05). */
accountApp.post('/logout-all', async (c) => {
  const web = c.get('web');
  if (web) await logoutEverywhere(c.env.DB_IDENTITY, { userId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  deleteCookie(c, SESSION_COOKIE, { prefix: 'host', path: '/', secure: true });
  return c.redirect(web ? '/account?notice=logged_out_everywhere' : '/account', 303);
});

function linkPage(c: WebContext, body: Html, scripts?: Html): Html {
  return page(c, '加綁登入方式', html`<h1>加綁登入方式</h1>${body}<p><a href="/account">回到帳號中心</a></p>`, scripts ? { scripts } : {});
}

/** GET /account/link — adds the other sign-in method from the web (S-ID-02). Needs a login within 10 minutes. */
accountApp.get('/link', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/link', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const app = await webApp(c);
  if (!app) return c.redirect('/account', 303);
  const db = c.env.DB_IDENTITY;
  const linked = await db.prepare('SELECT provider FROM auth_identities WHERE user_id = ?').bind(web.userId).all<{ provider: string }>();
  const providers = linkableProviders(c, app, (linked.results ?? []).map((r) => r.provider));
  if (!providers.google && !providers.apple) {
    return c.html(linkPage(c, html`<div class="banner">您的帳號已綁定所有可用的登入方式。</div>`));
  }
  const now = Date.now();
  if (!isRecentLogin(web.createdAt, now)) {
    return c.html(
      linkPage(
        c,
        html`<div class="card"><p>為了確認是您本人，加綁前請重新登入。</p>
<form method="post" action="/account/logout"><input type="hidden" name="next" value="/account/link"><button type="submit">重新登入</button></form></div>`,
      ),
    );
  }
  const nonce = await issueNonce(db, WEB_APP_ID, now);
  const widgets = providerWidgets(c, { nonce, endpoint: '/account/link', next: '/account?notice=linked', google: providers.google, apple: providers.apple }, '綁定 Apple 帳號');
  return c.html(
    linkPage(
      c,
      html`<p>加綁後，可以用任一種方式登入同一個 Starry 帳號。請用要加綁的帳號完成登入。</p>
<div class="card">${widgets.body}</div>
<p class="muted">已經屬於其他 Starry 會員的 Apple 或 Google 帳號無法加綁。</p>`,
      widgets.scripts,
    ),
  );
});

const LINK_FAILURES: Record<Exclude<LinkResult, 'linked' | 'already_linked'>, { status: 409; code: 'IDENTITY_IN_USE' | 'PROVIDER_ALREADY_LINKED'; message: string }> = {
  identity_in_use: { status: 409, code: 'IDENTITY_IN_USE', message: 'This sign-in already belongs to another Starry account' },
  provider_in_use: { status: 409, code: 'PROVIDER_ALREADY_LINKED', message: 'A different sign-in of this provider is already linked' },
};

/** POST /account/link — the link page's script sends the new provider's ID token here. */
accountApp.post('/link', async (c) => {
  const requestId = c.get('requestId');
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', requestId), 401);
  const now = Date.now();
  if (!isRecentLogin(web.createdAt, now)) return c.json(errorBody('REAUTH_REQUIRED', 'Sign in again before linking', requestId), 403);
  const body = await readJsonObject(c);
  const requested = body?.provider;
  const provider: Provider | null = requested === 'apple' || requested === 'google' ? requested : null;
  const request = readProviderRequest(body);
  if (!provider || !request) return c.json(errorBody('BAD_REQUEST', 'provider, id_token and nonce are required', requestId), 400);
  const app = await webApp(c);
  if (!app) return c.json(errorBody('APP_UNAVAILABLE', 'Web sign-in is not available', requestId), 403);
  const verified = await verifyProviderRequest(c, provider, app, request, `account.link.${provider}`, web.userId);
  if (!verified.ok) return verified.response;
  const db = c.env.DB_IDENTITY;
  const { identity } = verified;
  const outcome = await linkIdentity(db, { userId: web.userId, appId: WEB_APP_ID, requestId }, { provider, subject: identity.subject, email: identity.email, isPrivateRelay: identity.isPrivateRelay }, now);
  if (outcome === 'identity_in_use' || outcome === 'provider_in_use') {
    const failure = LINK_FAILURES[outcome];
    return c.json(errorBody(failure.code, failure.message, requestId), failure.status);
  }
  if (provider === 'apple' && request.authorizationCode && outcome === 'linked') {
    const pending = background(
      c,
      rememberAppleToken(db, c.env, (url, init) => fetch(url, init), { userId: web.userId, subject: identity.subject, clientId: identity.audience, code: request.authorizationCode, redirectUri: appleRedirectUri(c), appId: WEB_APP_ID, requestId }, now),
    );
    if (pending) await pending;
  }
  return c.json({ ok: true, result: outcome });
});

accountApp.post('/consent', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  await acceptConsents(c.env.DB_IDENTITY, { userId: web.userId, termsVersion: c.env.TERMS_VERSION, privacyVersion: c.env.PRIVACY_VERSION, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  return c.redirect('/account', 303);
});

function profileForm(c: WebContext, p: ProfileRow, message?: { text: string; danger: boolean }): Html {
  return page(
    c,
    '編輯個人資料',
    html`<h1>編輯個人資料</h1>
${message ? html`<div class="banner ${message.danger ? 'danger' : ''}">${message.text}</div>` : ''}
<form method="post" action="/account/profile" class="card">
  <input type="hidden" name="version" value="${p.version}">
  <label for="display_name">顯示名稱（1～50 字，可留空）</label>
  <input id="display_name" name="display_name" maxlength="50" value="${p.display_name ?? ''}">
  <label for="birthday">生日（選填）</label>
  <input id="birthday" name="birthday" type="date" value="${p.birthday ?? ''}">
  <label for="locale">語系</label>
  <select id="locale" name="locale">${Object.entries(LOCALES).map(([v, label]) => html`<option value="${v}"${v === p.locale ? raw(' selected') : ''}>${label}</option>`)}</select>
  <button type="submit">儲存</button> <a href="/account">取消</a>
</form>`,
  );
}

accountApp.get('/profile', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/profile', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const p = await c.env.DB_IDENTITY.prepare(PROFILE_SQL).bind(web.userId).first<ProfileRow>();
  if (!p) return c.redirect('/account', 303);
  return c.html(profileForm(c, p));
});

accountApp.post('/profile', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const form = await readForm(c);
  const db = c.env.DB_IDENTITY;
  const current = await db.prepare(PROFILE_SQL).bind(web.userId).first<ProfileRow>();
  if (!current) return c.redirect('/account', 303);
  const version = Number(form.version);
  const name = (form.display_name ?? '').trim();
  const birthday = (form.birthday ?? '').trim();
  const locale = form.locale ?? current.locale;
  const now = Date.now();
  if ((name !== '' && !boundedString(name, 50)) || (birthday !== '' && !isBirthday(birthday, now)) || !isLocale(locale) || !Number.isInteger(version)) {
    return c.html(profileForm(c, current, { text: '資料格式不正確：顯示名稱最多 50 字，生日須為有效日期。', danger: true }), 400);
  }
  const changes: ProfileChanges = { display_name: name === '' ? null : name, birthday: birthday === '' ? null : birthday, locale };
  const result = await updateProfile(db, { userId: web.userId, expectedVersion: version, changes, appId: WEB_APP_ID, requestId: c.get('requestId') }, now);
  if (!result.profile) return c.redirect('/account', 303);
  if (!result.written) return c.html(profileForm(c, result.profile, { text: '個人資料已在其他地方更新，以下是最新內容，請確認後再儲存。', danger: true }), 409);
  return c.html(profileForm(c, result.profile, { text: '已儲存。', danger: false }));
});

accountApp.get('/delete', (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/delete', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  return c.html(
    page(
      c,
      '刪除帳號',
      html`<h1>刪除 Starry 帳號</h1>
<div class="card">
  <ul>
    <li>帳號會立即停用，所有繁星 App 與裝置都會登出。</li>
    <li>7 天內用同一個 Apple 或 Google 帳號登入，可以撤回刪除。</li>
    <li>7 天後永久刪除個人資料、頭像、登入方式與客服紀錄，無法復原。</li>
    <li>刪除帳號不會自動取消 App Store 或 Google Play 的訂閱，請先到商店取消。</li>
  </ul>
  <form method="post" action="/account/delete">
    <label><input type="checkbox" name="confirm" value="yes" required style="width:auto"> 我了解並要刪除帳號</label>
    <button class="danger" type="submit">刪除帳號</button> <a href="/account">取消</a>
  </form>
</div>`,
    ),
  );
});

accountApp.post('/delete', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const form = await readForm(c);
  if (form.confirm !== 'yes') return c.redirect('/account/delete', 303);
  const result = await requestDeletion(c.env.DB_IDENTITY, { userId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  deleteCookie(c, SESSION_COOKIE, { prefix: 'host', path: '/', secure: true });
  c.set('web', null);
  if (!result.ok) return c.redirect('/account', 303);
  return c.html(
    page(
      c,
      '已收到刪除申請',
      html`<h1>已收到刪除申請</h1>
<div class="card"><p>帳號已停用，並將於 <strong>${formatTime(result.purgeAt)}</strong> 永久刪除。</p>
<p>如果改變心意，請在此之前回到<a href="/account">帳號中心</a>或任一繁星 App 重新登入並撤回。</p></div>`,
    ),
  );
});

accountApp.post('/delete/cancel', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account', 303);
  await cancelDeletion(c.env.DB_IDENTITY, { userId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  return c.redirect('/account', 303);
});

/** One-time owner bootstrap (see claimOwner); only visible while OWNER_CLAIM_CODE is set. */
accountApp.get('/claim-owner', (c) => {
  const web = c.get('web');
  if (!c.env.OWNER_CLAIM_CODE) return c.redirect('/account', 303);
  if (!web) return c.redirect('/account?next=/account/claim-owner', 303);
  return c.html(
    page(
      c,
      '設定 Owner',
      html`<h1>設定 Owner</h1><form method="post" action="/account/claim-owner" class="card">
<p>輸入在 Cloudflare 設定的 OWNER_CLAIM_CODE，將目前登入的帳號設為 Starry Owner。完成後請刪除該 Secret。</p>
<label for="code">Owner 密語</label><input id="code" name="code" type="password" autocomplete="off" required>
<button type="submit">確認</button></form>`,
    ),
  );
});

accountApp.post('/claim-owner', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account', 303);
  const code = (await readForm(c)).code ?? '';
  const result = await claimOwner(c.env.DB_IDENTITY, c.env.OWNER_CLAIM_CODE, web.userId, code, c.get('requestId'), Date.now());
  const text: Record<typeof result, string> = {
    claimed: '已設為 Owner。請到 Cloudflare 刪除 OWNER_CLAIM_CODE。',
    disabled: '目前沒有開放設定 Owner。',
    already_claimed: '已經有 Owner，無法再次設定。',
    wrong_code: '密語不正確。',
    not_active: '帳號目前不能執行這個操作。',
  };
  return c.html(page(c, '設定 Owner', html`<h1>設定 Owner</h1><div class="banner${result === 'claimed' ? '' : ' danger'}">${text[result]}</div><p><a href="${result === 'claimed' ? '/admin' : '/account'}">繼續</a></p>`), result === 'claimed' ? 200 : 403);
});
