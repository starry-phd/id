import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import { audiencesFor, getApp, type AppEntry } from '../apps/registry';
import { getBalance, recentActivity } from '../battery/battery';
import { redeemInvite } from '../battery/invites';
import { listQuantum } from '../battery/quantum';
import { exportMemberData } from '../identity/export';
import { getNotices } from '../lib/notices';
import { withEffectiveStatus } from '../apps/status';
import type { Provider } from '../auth/provider-keys';
import { background, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { mailSettings } from '../notify/email';
import { listActiveSessions, logoutEverywhere, revokeOwnSession } from '../identity/devices';
import { googlePhotoOf, importProviderAvatar, MAX_AVATAR_BYTES, r2Store, rememberProviderPhoto, removeAvatar, setAvatar } from '../identity/avatars';
import { cleanupAfterDeletion } from '../identity/erase';
import { cancelDeletion, DELETION_GRACE_MS, deleteMemberNow } from '../identity/lifecycle';
import { linkIdentity, type LinkResult } from '../identity/link';
import { completeMerge, findMergeCandidate, type MergeBlocker } from '../identity/merge';
import { acceptConsents, consentRequired, findOrCreateMember, PROFILE_SQL, type ProfileRow } from '../identity/members';
import { confirmContactEmail, sendContactEmailVerification, type ConfirmResult } from '../identity/contact-email';
import { randomMotto } from '../identity/mottos';
import {
  ageOn, derivedOf, EDITABLE_FIELDS, effectiveVisibility, GRID_LAYOUT, hasChanges, loadProfile, saveProfile, validateProfileInput,
  type EditableField, type FieldUpdate, type Visibility, type VisibilityField,
} from '../identity/profile';
import { consumeNonce, issueNonce } from '../identity/nonces';
import { base64urlDecode, base64urlEncode, fromUtf8, utf8 } from '../lib/encoding';
import { readClientData, verifyAssertion, verifyRegistration } from '../auth/webauthn';
import { addPasskey, findPasskey, listPasskeys, MAX_PASSKEYS, removePasskey, touchPasskey } from '../identity/passkeys';

import { claimOwner, hasRole, isRecentLogin, listAppStaffApps, roleOf } from '../identity/roles';
import { createWebSession, endWebSession, WEB_APP_ID, WEB_SESSION_ABSOLUTE_MS } from '../identity/web-sessions';
import { errorBody } from '../lib/errors';
import { open as unseal, seal } from '../lib/sealed';
import { readJsonObject } from '../lib/validate';
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
function appleRedirectUri(c: WebContext): string {
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
  passkey_added: 'Passkey 已新增，下次可以直接用它登入。',
  passkey_removed: 'Passkey 已移除。',
  logged_out_everywhere: '已登出所有裝置與 App。',
  merged: '已合併帳號。現在用 Apple 或 Google 都會登入這個帳號。',
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
  memberNo: string | null;
  deletionRequestedAt: number | null;
  profile: ProfileRow;
  identities: { provider: string; email: string | null }[];
}

async function loadAccount(db: D1Database, userId: string): Promise<AccountView | null> {
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
  const passkeys = pending ? [] : await listPasskeys(db, web.userId);
  const managedApps = pending ? [] : await listAppStaffApps(db, web.userId);
  const inviteMsg = ({ ok: '兌換成功，已加入量子電池。', invalid: '邀請碼不正確、已停用或已過期。', already: '你已經兌換過這組邀請碼。', used_up: '這組邀請碼已被領完。' } as Record<string, string>)[c.req.query('invite') ?? ''] ?? '';
  const [battery, batteryActivity, quantum] = pending
    ? [null, null, []]
    : await Promise.all([getBalance(c.env.DB_BATTERY, web.userId, now), recentActivity(c.env.DB_BATTERY, web.userId, now, { limit: 10 }), listQuantum(c.env.DB_BATTERY, web.userId)]);
  const notices = await getNotices(db);
  const body = html`<h1>${p.display_name ?? '我的帳號'}</h1>
${notices.maintenance ? html`<div class="banner danger">系統維護中：${notices.maintenanceMessage || 'AI 功能暫時停用，帳號功能可正常使用。'}</div>` : ''}
${notices.announcement ? html`<div class="banner">${notices.announcement}</div>` : ''}
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
  <p><strong>姓名：</strong>${p.display_name ?? '（未設定）'}<br>
  <strong>聯絡 Email：</strong>${p.contact_email ? html`${p.contact_email}${p.contact_email_verified_at ? '' : html` <span class="muted">（待確認）</span>`}` : '（未設定）'}<br>
  <strong>手機：</strong>${p.phone ?? '（未設定）'}<br>
  <strong>地區：</strong>${[countryName(p.country), p.region, p.city].filter((v) => v).join(' ') || '（未設定）'}<br>
  <strong>生日：</strong>${p.birthday ? html`${p.birthday}（${derivedOf(p.birthday)?.zodiac_name ?? ''}）` : '（未設定）'}<br>
  <strong>座右銘：</strong>${p.motto ?? '（未設定）'}<br>
  <strong>語系：</strong>${LOCALES[p.locale] ?? p.locale}<br>
  <span class="muted">加入時間：${formatTime(account.createdAt)}</span></p>
  ${pending ? '' : html`<a class="button" href="/account/profile">編輯個人資料與公開設定</a>`}
</div>
<h2>登入方式</h2>
<div class="card">
  <ul>${account.identities.map((i) => html`<li>${PROVIDER_NAMES[i.provider] ?? i.provider}${i.email ? html`：${i.email}` : ''}</li>`)}</ul>
  <p class="muted">Email 由登入服務提供，只用於聯絡，無法在此修改。</p>
  ${linkable.google || linkable.apple ? html`<a class="button" href="/account/link">加綁${linkable.apple && linkable.google ? '其他' : linkable.apple ? ' Apple ' : ' Google '}登入方式</a>` : ''}
</div>
${managedApps.length > 0 ? html`<h2>我管理的 App</h2><div class="card"><ul>${managedApps.map((a) => html`<li>${appLabel(a)}：<a href="/admin/apps/${a}/config">遠端設定</a></li>`)}</ul></div>` : ''}
${pending
  ? ''
  : html`<h2>Passkey</h2>
<div class="card">
  ${passkeys.length > 0
    ? html`<ul>${passkeys.map((k) => html`<li>${k.name}（${formatTime(k.created_at)} 新增）<form class="inline" method="post" action="/account/passkey/${k.credential_id}/remove"><button class="secondary" type="submit">移除</button></form></li>`)}</ul>`
    : html`<p class="muted">還沒有 Passkey。新增後可以用指紋、臉部或螢幕鎖直接登入，不必再透過 Apple 或 Google。</p>`}
  ${passkeys.length < MAX_PASSKEYS ? html`<button id="add-passkey" type="button">新增 Passkey</button><p id="passkey-error" class="danger" role="alert"></p>` : ''}
</div>
<h2>登入中的裝置</h2>
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
${battery && batteryActivity
  ? html`<h2>Starry Battery</h2>
<div class="card">
  <p>本月剩餘 <strong>${battery.remaining}</strong> 顆 ／ 共 ${battery.allowance} 顆${battery.reserved > 0 ? html`（處理中 ${battery.reserved} 顆）` : ''}<br>
  <span class="muted">每月 1 日恢復，下次：${formatTime(battery.resets_at)}。Battery 是免費的 AI 使用額度，所有繁星 App 共用，不能購買或轉讓。</span></p>
  ${batteryActivity.entries.length > 0
    ? html`<table><tr><th>時間</th><th>項目</th><th>數量</th></tr>${batteryActivity.entries.map(
        (e) => html`<tr><td>${formatTime(e.created_at)}</td><td>${e.kind === 'usage' ? (e.task_label ?? appLabel(e.app_id ?? '')) : '客服調整'}</td><td>${e.kind === 'usage' ? `-${e.amount}` : e.amount > 0 ? `+${e.amount}` : `${e.amount}`}</td></tr>`,
      )}</table><p class="muted">顯示最近 30 天內最新 10 筆。</p>`
    : html`<p class="muted">最近 30 天沒有使用紀錄。</p>`}
  <h3>邀請碼</h3>
  ${inviteMsg ? html`<div class="banner">${inviteMsg}</div>` : ''}
  <form method="post" action="/account/redeem"><label for="invite-code">輸入邀請碼，領取免費量子電池</label><input id="invite-code" name="code" maxlength="40" autocomplete="off" required><button type="submit">兌換</button></form>
  ${quantum.length > 0
    ? html`<h3>量子電池</h3><table><tr><th>App</th><th>剩餘</th></tr>${quantum.map((q) => html`<tr><td>${appLabel(q.app_id)}</td><td>${q.available}</td></tr>`)}</table><p class="muted">在該 App 內購買的加量包，只能在購買的那款 App 使用；每次先用免費 Battery，用完才使用量子電池，不會過期。</p>`
    : ''}
</div>`
  : ''}
${role && hasRole(role, 'support') ? html`<p><a class="button" href="/admin">進入 Admin Lite</a></p>` : ''}
${pending ? '' : html`<h2>下載我的資料</h2><p class="muted">取得 Starry 保存的您的個人資料、登入方式、同意紀錄、使用過的 App 與電池紀錄（JSON 檔，不含密碼或憑證）。</p><a href="/account/export">下載我的資料</a>`}
${pending ? '' : html`<h2>刪除帳號</h2><p class="muted">確認後立即永久刪除，無法復原。</p><a href="/account/delete">申請刪除帳號</a>`}`;
  return c.html(page(c, '我的帳號', body, { scripts: pending ? html`` : passkeyScript(c, 'register') }));
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
<p class="muted">如果這個 Apple 或 Google 帳號之前單獨登入過、建立了另一個 Starry 帳號，完成登入後可以選擇把它合併到目前這個帳號。</p>`,
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
  if (outcome === 'identity_in_use') {
    // The sign-in made its own Starry account earlier: offer to merge it (S-ID-02 amendment).
    const found = await findMergeCandidate(db, c.env.DB_BILLING, c.env.OWNER_USER_IDS, web.userId, { provider, subject: identity.subject });
    const key = c.env.DATA_ENCRYPTION_KEY;
    if (found && !found.blocker && key) {
      const ticket: MergeTicket = { into: web.userId, from: found.candidate.userId, provider, subject: identity.subject, email: identity.email, relay: identity.isPrivateRelay, exp: now + MERGE_TICKET_MS };
      const sealed = await seal(key, MERGE_CONTEXT, JSON.stringify(ticket));
      if (sealed) {
        const merge = { ticket: sealed, provider, created_at: found.candidate.createdAt, display_name: found.candidate.displayName };
        return c.json({ ...errorBody('IDENTITY_IN_USE', LINK_FAILURES.identity_in_use.message, requestId), merge }, 409);
      }
    }
    return c.json({ ...errorBody('IDENTITY_IN_USE', LINK_FAILURES.identity_in_use.message, requestId), ...(found?.blocker ? { merge_blocked: found.blocker } : {}) }, 409);
  }
  if (outcome === 'provider_in_use') {
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
  if (outcome === 'linked') await rememberProviderPhoto(db, identity.subject, identity.picture);
  if (outcome === 'linked' && identity.picture && c.env.AVATARS) {
    // A member without an avatar (for example one who registered with Apple) gets the Google photo once Google is linked.
    const photo = background(c, importProviderAvatar(db, r2Store(c.env.AVATARS), (url, init) => fetch(url, init), { userId: web.userId, url: identity.picture, appId: WEB_APP_ID, requestId }, now));
    if (photo) await photo;
  }
  return c.json({ ok: true, result: outcome });
});

const MERGE_CONTEXT = 'account-merge-v1';
const MERGE_TICKET_MS = 10 * 60 * 1000;

/** What the member proved when linking; sealed so the page cannot change it or see the other member ID. */
interface MergeTicket {
  into: string;
  from: string;
  provider: Provider;
  subject: string;
  email: string | null;
  relay: boolean;
  exp: number;
}

function readTicket(raw: string | null): MergeTicket | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<MergeTicket>;
    const ok =
      typeof t.into === 'string' && typeof t.from === 'string' && (t.provider === 'apple' || t.provider === 'google') &&
      typeof t.subject === 'string' && (t.email === null || typeof t.email === 'string') && typeof t.relay === 'boolean' && typeof t.exp === 'number';
    return ok ? (t as MergeTicket) : null;
  } catch {
    return null;
  }
}

/** POST /account/link/merge — confirms merging the duplicate account found while linking. */
accountApp.post('/link/merge', async (c) => {
  const requestId = c.get('requestId');
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', requestId), 401);
  const now = Date.now();
  if (!isRecentLogin(web.createdAt, now)) return c.json(errorBody('REAUTH_REQUIRED', 'Sign in again before merging', requestId), 403);
  const body = await readJsonObject(c);
  const key = c.env.DATA_ENCRYPTION_KEY;
  const rawTicket = body?.ticket;
  const sealed = typeof rawTicket === 'string' && rawTicket.length <= 4096 ? rawTicket : null;
  const ticket = readTicket(sealed && key ? await unseal(key, MERGE_CONTEXT, sealed) : null);
  if (!ticket || ticket.into !== web.userId || ticket.exp <= now) return c.json(errorBody('BAD_REQUEST', 'The merge request expired; link again', requestId), 400);
  const db = c.env.DB_IDENTITY;
  const found = await findMergeCandidate(db, c.env.DB_BILLING, c.env.OWNER_USER_IDS, web.userId, { provider: ticket.provider, subject: ticket.subject });
  if (!found || found.candidate.userId !== ticket.from) return c.json(errorBody('CONFLICT', 'The accounts changed; link again', requestId), 409);
  const blocker: MergeBlocker | null = found.blocker;
  if (blocker) return c.json({ ...errorBody('IDENTITY_IN_USE', LINK_FAILURES.identity_in_use.message, requestId), merge_blocked: blocker }, 409);
  const merged = await completeMerge(
    { db, battery: c.env.DB_BATTERY, ...(c.env.AVATARS ? { avatars: c.env.AVATARS } : {}) },
    { userId: web.userId, appId: WEB_APP_ID, requestId },
    { provider: ticket.provider, subject: ticket.subject, email: ticket.email, isPrivateRelay: ticket.relay },
    ticket.from,
    now,
  );
  if (!merged) return c.json(errorBody('CONFLICT', 'The accounts changed; link again', requestId), 409);
  return c.json({ ok: true, result: 'merged' });
});

accountApp.post('/redeem', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const form = await readForm(c);
  const result = await redeemInvite(c.env.DB_BATTERY, web.userId, form.code ?? '', Date.now());
  return c.redirect(`/account?invite=${result.ok ? 'ok' : result.reason}`, 303);
});

accountApp.post('/consent', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  await acceptConsents(c.env.DB_IDENTITY, { userId: web.userId, termsVersion: c.env.TERMS_VERSION, privacyVersion: c.env.PRIVACY_VERSION, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  return c.redirect('/account', 303);
});

// ---- Personal profile (S-ID-08, original checklist 02.01-02.10) ----

const COUNTRIES: readonly (readonly [string, string])[] = [
  ['TW', '台灣'], ['HK', '香港'], ['MO', '澳門'], ['CN', '中國大陸'], ['JP', '日本'], ['KR', '韓國'], ['SG', '新加坡'], ['MY', '馬來西亞'],
  ['TH', '泰國'], ['VN', '越南'], ['PH', '菲律賓'], ['ID', '印尼'], ['US', '美國'], ['CA', '加拿大'], ['GB', '英國'], ['AU', '澳洲'],
  ['NZ', '紐西蘭'], ['DE', '德國'], ['FR', '法國'],
];
const countryName = (code: string | null) => (code ? (COUNTRIES.find(([c]) => c === code)?.[1] ?? code) : null);

interface FieldSpec {
  field: EditableField;
  label: string;
  /** The visibility switch shown on this row (the location switch sits on the country row). */
  eye: VisibilityField | null;
  input: 'text' | 'email' | 'tel' | 'date' | 'country' | 'locale' | 'textarea' | 'url';
  max?: number;
  hint?: string;
  /** Shown instead of the visibility switch: the field is always public. */
  alwaysPublic?: boolean;
}

const PROFILE_FIELDS: readonly FieldSpec[] = [
  { field: 'nickname', label: '暱稱', eye: null, input: 'text', max: 30, alwaysPublic: true, hint: '一律公開（排行榜等功能會顯示暱稱與頭像），最多 30 字。' },
  { field: 'display_name', label: '姓名', eye: 'display_name', input: 'text', max: 50, hint: '你的姓名，1～50 字，可以選擇不公開。' },
  { field: 'contact_email', label: '主要聯絡 Email', eye: 'contact_email', input: 'email', hint: '變更後會寄確認信；確認前，系統通知仍寄到登入用的信箱。' },
  { field: 'phone', label: '手機（選填）', eye: 'phone', input: 'tel', hint: '可輸入 0912345678，會依國家自動加上國碼。預設不公開。' },
  { field: 'country', label: '國家／地區', eye: 'location', input: 'country', hint: '這裡的公開設定同時套用到省／州／縣市與城市。' },
  { field: 'region', label: '省／州／縣市', eye: null, input: 'text', max: 60 },
  { field: 'city', label: '城市／鄉鎮區', eye: null, input: 'text', max: 60 },
  { field: 'birthday', label: '生日', eye: 'birthday', input: 'date', hint: '公開時只顯示月日；未滿 18 歲不會公開。' },
  { field: 'motto', label: '座右銘', eye: 'motto', input: 'textarea', max: 200 },
  { field: 'bio', label: '自我介紹', eye: 'bio', input: 'textarea', max: 500, hint: '最多 500 字。' },
  { field: 'occupation', label: '職業', eye: 'occupation', input: 'text', max: 60, hint: '例如：軟體工程師、護理師、學生。這裡的公開設定同時套用到服務單位。' },
  { field: 'organization', label: '服務單位', eye: null, input: 'text', max: 80, hint: '公司、機構或學校名稱。' },
  { field: 'website', label: '個人網站', eye: 'website', input: 'url', max: 200, hint: '必須以 https:// 開頭。' },
  { field: 'languages', label: '使用語言', eye: 'languages', input: 'text', max: 100, hint: '例如：中文、English、日本語。' },
  { field: 'interests', label: '興趣', eye: 'interests', input: 'textarea', max: 200, hint: '用逗號或換行分隔，最多 200 字。' },
  { field: 'skills', label: '專長', eye: 'skills', input: 'textarea', max: 200, hint: '用逗號或換行分隔，最多 200 字。' },
  { field: 'university', label: '大學校名', eye: 'education', input: 'text', max: 80, hint: '這裡的公開設定同時套用到大學科系、研究所校名與科系。' },
  { field: 'university_dept', label: '大學科系', eye: null, input: 'text', max: 60 },
  { field: 'grad_school', label: '大學研究所校名', eye: null, input: 'text', max: 80 },
  { field: 'grad_dept', label: '大學研究所科系', eye: null, input: 'text', max: 60 },
  { field: 'locale', label: '語系', eye: null, input: 'locale' },
];

const SOURCE_LABELS: Record<string, string> = { member: '本人', staff: '客服人員' };
const NUMBER_COLORS = ['', '#e5484d', '#f76b15', '#e2a336', '#30a46c', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ad7f58'];

function displayValue(p: ProfileRow, field: EditableField): string {
  switch (field) {
    case 'country':
      return countryName(p.country) ?? '';
    case 'locale':
      return LOCALES[p.locale] ?? p.locale;
    case 'contact_email':
      return p.contact_email ? `${p.contact_email}（${p.contact_email_verified_at ? '已確認' : '待確認'}）` : '';
    default:
      return p[field] ?? '';
  }
}

function fieldInput(spec: FieldSpec, p: ProfileRow): Html {
  const value = spec.field === 'locale' ? p.locale : (p[spec.field] ?? '');
  const id = `f-${spec.field}`;
  switch (spec.input) {
    case 'country':
      return html`<select id="${id}" name="value"><option value="">（未設定）</option>${COUNTRIES.map(([code, name]) => html`<option value="${code}"${code === p.country ? raw(' selected') : ''}>${name}</option>`)}</select>`;
    case 'locale':
      return html`<select id="${id}" name="value">${Object.entries(LOCALES).map(([v, label]) => html`<option value="${v}"${v === p.locale ? raw(' selected') : ''}>${label}</option>`)}</select>`;
    case 'textarea':
      return html`<textarea id="${id}" name="value" rows="3" maxlength="${spec.max ?? 200}">${value}</textarea>`;
    default:
      return html`<input id="${id}" name="value" type="${spec.input}" value="${value}"${spec.max ? raw(` maxlength="${spec.max}"`) : ''}${spec.input === 'tel' ? raw(' inputmode="tel" autocomplete="tel"') : ''}>`;
  }
}

function eyeForm(group: VisibilityField, visibility: Record<VisibilityField, Visibility>, version: number, locked: boolean): Html {
  const isPublic = visibility[group] === 'public';
  if (locked) return html`<span class="muted">🔒 不公開</span>`;
  return html`<form class="inline eye" method="post" action="/account/profile"><input type="hidden" name="version" value="${version}"><input type="hidden" name="field" value="visibility.${group}"><input type="hidden" name="value" value="${isPublic ? 'private' : 'public'}"><button class="secondary" type="submit" title="${isPublic ? '目前公開，按一下改為不公開' : '目前不公開，按一下改為公開'}">${isPublic ? '👁 公開' : '🙈 不公開'}</button></form>`;
}

function updatedLine(updates: Record<string, FieldUpdate>, field: string): Html {
  const u = updates[field];
  return u ? html`<p class="muted updated">最後修改：${formatTime(u.updated_at)}（${SOURCE_LABELS[u.source] ?? u.source}）</p>` : html`<p class="muted updated"></p>`;
}

function derivedCard(p: ProfileRow, visibility: Record<VisibilityField, Visibility>, version: number, minor: boolean): Html {
  const d = derivedOf(p.birthday);
  if (!d) return html`<div class="card"><p class="muted">填寫生日後，這裡會顯示星座、天賦數、生命靈數與彩色九宮格。</p></div>`;
  const counts = new Map(d.grid.map((g) => [g.number, g.count]));
  return html`<div class="card">
<p style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>由生日推算</strong>${eyeForm('derived', visibility, version, minor)}</p>
<p>星座：<strong>${d.zodiac_name}</strong><br>天賦數：<strong>${d.talent_numbers.length > 0 ? d.talent_numbers.join('、') : '—'}</strong><br>生命靈數：<strong>${d.life_path_number}</strong></p>
<table class="grid9" aria-label="彩色九宮格">${GRID_LAYOUT.map(
    (row) => html`<tr>${row.map((n) => {
      const count = counts.get(n) ?? 0;
      return html`<td style="${count > 0 ? `background:${NUMBER_COLORS[n]};color:#fff` : ''}"><strong>${n}</strong>${count > 1 ? html`<sup>×${count}</sup>` : ''}</td>`;
    })}</tr>`,
  )}</table>
<p class="muted">連線：${d.lines.length > 0 ? d.lines.join('、') : '無'}。公開時只顯示星座與生命靈數（天賦數與九宮格會透露出生年，不會公開）。</p>
</div>`;
}

function profilePage(c: WebContext, loaded: { row: ProfileRow; fieldUpdates: Record<string, FieldUpdate> }, message?: { text: string; danger: boolean }): Html {
  const p = loaded.row;
  const now = Date.now();
  const visibility = effectiveVisibility(p, now);
  const minor = p.birthday !== null && ageOn(p.birthday, now) < 18;
  const nonce = c.get('cspNonce');
  const rows = PROFILE_FIELDS.map((spec) => {
    const locked = minor && spec.eye === 'birthday';
    return html`<div class="card field" data-field="${spec.field}">
<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${spec.label}</strong><span>${spec.alwaysPublic ? html`<span class="muted">🌐 一律公開</span>` : spec.eye ? eyeForm(spec.eye, visibility, p.version, locked) : ''}<button class="secondary pencil" type="button" aria-label="編輯${spec.label}" hidden>✏️ 編輯</button></span></div>
<p class="value">${displayValue(p, spec.field) || html`<span class="muted">（未設定）</span>`}</p>
<form class="field-form" method="post" action="/account/profile">
<input type="hidden" name="version" value="${p.version}"><input type="hidden" name="field" value="${spec.field}">
<label for="f-${spec.field}" class="muted" style="font-weight:400">${spec.hint ?? `修改${spec.label}`}</label>
${fieldInput(spec, p)}
${spec.field === 'motto' ? html`<button class="secondary suggest" type="button" hidden>🎲 隨機提案</button>` : ''}
<button type="submit">儲存</button><span class="status muted" role="status" aria-live="polite"></span>
</form>
${spec.field === 'contact_email' && p.contact_email && !p.contact_email_verified_at
  ? html`<form method="post" action="/account/contact-email/verify"><button class="secondary" type="submit">重寄確認信</button></form>`
  : ''}
${updatedLine(loaded.fieldUpdates, spec.field)}
</div>`;
  });
  return page(
    c,
    '個人資料',
    html`<h1>個人資料</h1>
${message ? html`<div class="banner ${message.danger ? 'danger' : ''}">${message.text}</div>` : ''}
<p class="muted">所有繁星 App 共用這份資料。按 ✏️ 編輯，離開欄位會自動儲存；👁 設定其他會員能不能看到。</p>
<style>.js .field-form{display:none}.js .field.editing .field-form{display:block}.js .field.editing .value{display:none}.grid9{width:auto;margin:8px 0}.grid9 td{width:56px;height:56px;text-align:center;border:1px solid var(--line);font-size:1.2rem}.eye button,.pencil{margin:0 0 0 8px;padding:4px 10px}</style>
<div class="card" id="avatar-card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>頭像</strong><span class="muted">🌐 一律公開</span></div>
<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:8px">
${p.avatar_key ? html`<img id="avatar-now" src="/account/avatar-image?v=${p.version}" alt="目前的頭像" width="96" height="96" style="border-radius:50%;object-fit:cover">` : html`<div style="width:96px;height:96px;border-radius:50%;background:var(--line);display:flex;align-items:center;justify-content:center;font-size:2rem">${(p.nickname ?? p.display_name ?? '星').slice(0, 1)}</div>`}
<div><label for="avatar-file" class="button secondary" style="background:transparent;color:var(--accent);margin:0">上傳並裁切頭像</label><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
<button type="button" class="secondary" id="avatar-google">使用我的 Google 頭像</button>${p.avatar_key ? html`<button type="button" class="secondary" id="avatar-remove">移除頭像</button>` : ''}
<p class="muted" id="avatar-status" role="status" aria-live="polite">頭像一律公開，無法隱藏。沒有頭像時顯示暱稱（或姓名）的第一個字。</p></div></div>
<div id="avatar-crop" hidden style="margin-top:12px"><canvas id="avatar-canvas" width="256" height="256" style="width:256px;height:256px;max-width:100%;border-radius:12px;border:1px solid var(--line);touch-action:none;cursor:grab"></canvas>
<label for="avatar-zoom" class="muted" style="font-weight:400">縮放（拖曳圖片可調整位置）</label><input id="avatar-zoom" type="range" min="1" max="4" step="0.01" value="1" style="width:256px;max-width:100%">
<div><button type="button" id="avatar-save">儲存頭像</button><button type="button" class="secondary" id="avatar-cancel">取消</button></div></div>
${updatedLine(loaded.fieldUpdates, 'avatar')}</div>
${rows}
<h2>生日資訊</h2>
${derivedCard(p, visibility, p.version, minor)}
<p><a href="/account">回到帳號中心</a></p>`,
    {
      scripts: html`<script nonce="${nonce}">
document.documentElement.classList.add('js');

(function () {
  var fileInput = document.getElementById('avatar-file');
  var crop = document.getElementById('avatar-crop');
  var canvas = document.getElementById('avatar-canvas');
  var zoom = document.getElementById('avatar-zoom');
  var status = document.getElementById('avatar-status');
  var ctx = canvas.getContext('2d');
  var img = null, scale = 1, minScale = 1, ox = 0, oy = 0, dragging = null;
  function say(text) { status.textContent = text; }
  function clamp() {
    var w = img.width * scale, h = img.height * scale;
    ox = Math.min(0, Math.max(256 - w, ox)); oy = Math.min(0, Math.max(256 - h, oy));
  }
  function draw() { ctx.clearRect(0, 0, 256, 256); ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale); }
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!/^image\\/(png|jpeg|webp)$/.test(file.type)) { say('請選擇 PNG、JPEG 或 WebP 圖片。'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var image = new Image();
      image.onload = function () {
        img = image;
        minScale = 256 / Math.min(image.width, image.height);
        scale = minScale; zoom.value = '1';
        ox = (256 - image.width * scale) / 2; oy = (256 - image.height * scale) / 2;
        crop.hidden = false; draw(); say('拖曳與縮放調整範圍，然後按「儲存頭像」。');
      };
      image.onerror = function () { say('無法讀取這張圖片。'); };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
  zoom.addEventListener('input', function () {
    if (!img) return;
    var cx = (128 - ox) / scale, cy = (128 - oy) / scale;
    scale = minScale * Number(zoom.value);
    ox = 128 - cx * scale; oy = 128 - cy * scale; clamp(); draw();
  });
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * 256 / r.width, y: (e.clientY - r.top) * 256 / r.height }; }
  canvas.addEventListener('pointerdown', function (e) { if (!img) return; dragging = pos(e); canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', function (e) { if (!dragging) return; var p = pos(e); ox += p.x - dragging.x; oy += p.y - dragging.y; dragging = p; clamp(); draw(); });
  function stop() { dragging = null; canvas.style.cursor = 'grab'; }
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
  document.getElementById('avatar-cancel').addEventListener('click', function () { crop.hidden = true; img = null; fileInput.value = ''; say('已取消。'); });
  async function send(url, init, okText) {
    say('處理中…');
    var res = await fetch(url, init).catch(function () { return null; });
    var body = res ? await res.json().catch(function () { return {}; }) : {};
    if (res && res.ok && body.ok) { say(okText); location.reload(); return; }
    say(body.message || '操作失敗，請再試一次。');
  }
  document.getElementById('avatar-save').addEventListener('click', function () {
    if (!img) return;
    var quality = 0.9;
    var attempt = function () {
      canvas.toBlob(function (blob) {
        if (!blob) { say('無法產生圖片。'); return; }
        if (blob.size > 250 * 1024 && quality > 0.4) { quality -= 0.15; attempt(); return; }
        send('/account/avatar', { method: 'POST', headers: { 'content-type': 'image/jpeg', accept: 'application/json' }, body: blob }, '頭像已更新。');
      }, 'image/jpeg', quality);
    };
    attempt();
  });
  document.getElementById('avatar-google').addEventListener('click', function () { send('/account/avatar/google', { method: 'POST', headers: { accept: 'application/json' } }, '已改用 Google 頭像。'); });
  var removeButton = document.getElementById('avatar-remove');
  if (removeButton) removeButton.addEventListener('click', function () { if (confirm('確定要移除頭像嗎？')) send('/account/avatar/remove', { method: 'POST', headers: { accept: 'application/json' } }, '頭像已移除。'); });
})();
const STATUS = { saving: '儲存中…', saved: '已儲存', conflict: '資料已在其他地方更新，請重新整理頁面。', failed: '儲存失敗，請再試一次。' };
let version = ${p.version};
function setVersion(v) { version = v; document.querySelectorAll('input[name=version]').forEach((i) => { i.value = String(v); }); }
async function save(form) {
  const status = form.querySelector('.status');
  const field = form.closest('.field');
  status.textContent = STATUS.saving;
  form.querySelector('input[name=version]').value = String(version);
  const res = await fetch('/account/profile', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (res && res.ok && body.ok) {
    setVersion(body.version);
    field.querySelector('.value').textContent = body.display || '（未設定）';
    if (body.updated) field.querySelector('.updated').textContent = body.updated;
    status.textContent = STATUS.saved;
    field.classList.remove('editing');
    if (body.reload) location.reload();
    return;
  }
  status.textContent = res && res.status === 409 ? STATUS.conflict : (body.message || STATUS.failed);
}
document.querySelectorAll('.field[data-field]').forEach((field) => {
  const form = field.querySelector('.field-form');
  const pencil = field.querySelector('.pencil');
  const input = form.querySelector('[name=value]');
  let initial = input.value;
  pencil.hidden = false;
  pencil.addEventListener('click', () => { field.classList.add('editing'); input.focus(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); initial = input.value; save(form); });
  const autosave = () => { if (input.value !== initial) { initial = input.value; save(form); } };
  input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'blur', autosave);
  const suggest = form.querySelector('.suggest');
  if (suggest) {
    suggest.hidden = false;
    suggest.addEventListener('click', async () => {
      const res = await fetch('/account/motto-suggestion?current=' + encodeURIComponent(input.value)).catch(() => null);
      const body = res && res.ok ? await res.json() : null;
      if (body && body.motto) { input.value = body.motto; form.querySelector('.status').textContent = '這是提案，按「儲存」才會更新。'; }
    });
  }
});
</script>`,
    },
  );
}

function updatedText(updates: Record<string, FieldUpdate>, field: string): string {
  const u = updates[field];
  return u ? `最後修改：${formatTime(u.updated_at)}（${SOURCE_LABELS[u.source] ?? u.source}）` : '';
}

accountApp.get('/profile', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/profile', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const loaded = await loadProfile(c.env.DB_IDENTITY, web.userId);
  if (!loaded) return c.redirect('/account', 303);
  const notice = PROFILE_NOTICES[c.req.query('notice') ?? ''];
  return c.html(profilePage(c, loaded, notice));
});

const PROFILE_NOTICES: Record<string, { text: string; danger: boolean }> = {
  verification_sent: { text: '已寄出確認信，請到信箱點連結完成確認（24 小時內有效）。', danger: false },
  verification_unavailable: { text: '目前無法寄出確認信，請稍後再試。', danger: true },
  verified: { text: '聯絡信箱已確認，之後的系統通知會寄到這裡。', danger: false },
};

/**
 * POST /account/profile — one field per request from the profile page (field + value, or
 * visibility.<group>), or several fields from a plain form. JSON when the page's script asks.
 */
accountApp.post('/profile', async (c) => {
  const web = c.get('web');
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  if (!web || web.status !== 'active') return wantsJson ? c.json({ ok: false, message: '請重新登入。' }, 401) : c.redirect('/account', 303);
  const form = await readForm(c);
  const db = c.env.DB_IDENTITY;
  const before = await loadProfile(db, web.userId);
  if (!before) return c.redirect('/account', 303);
  const now = Date.now();
  const version = Number(form.version);
  let input: Record<string, unknown> = {};
  if (form.field?.startsWith('visibility.')) input = { visibility: { [form.field.slice('visibility.'.length)]: form.value } };
  else if (form.field) input = (EDITABLE_FIELDS as readonly string[]).includes(form.field) ? { [form.field]: form.value ?? '' } : { visibility: null };
  else for (const field of EDITABLE_FIELDS) if (field in form) input[field] = field === 'display_name' && form[field] === '' ? null : form[field];
  const validated = validateProfileInput(input, now, before.row.country);
  const respond = async (status: 200 | 400 | 409, message: { text: string; danger: boolean }) => {
    const current = (await loadProfile(db, web.userId)) ?? before;
    if (wantsJson) {
      const field = (form.field ?? '') as EditableField;
      const ok = status === 200;
      return c.json(
        {
          ok,
          message: ok ? undefined : message.text,
          version: current.row.version,
          display: (EDITABLE_FIELDS as readonly string[]).includes(field) ? displayValue(current.row, field) : undefined,
          updated: updatedText(current.fieldUpdates, field),
          reload: field === 'birthday' || field === 'contact_email' || (form.field ?? '').startsWith('visibility.'),
        },
        status,
      );
    }
    return c.html(profilePage(c, current, message), status);
  };
  if (!validated.ok) return respond(400, { text: `資料格式不正確：${validated.message}。`, danger: true });
  if (!Number.isInteger(version) || !hasChanges(validated.changes)) return respond(400, { text: '沒有要儲存的變更。', danger: true });
  const saved = await saveProfile(db, { userId: web.userId, expectedVersion: version, changes: validated.changes, source: 'member', actorUserId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, now);
  if (!saved.written) return respond(409, { text: '個人資料已在其他地方更新，以下是最新內容，請確認後再儲存。', danger: true });
  if (saved.newContactEmail) {
    const pending = background(c, sendContactEmailVerification(c.env.DATA_ENCRYPTION_KEY, mailSettings(c.env, new URL(c.req.url).origin), web.userId, saved.newContactEmail, now));
    if (pending) await pending;
  }
  return respond(200, { text: saved.newContactEmail ? '已儲存，並寄出聯絡信箱的確認信。' : '已儲存。', danger: false });
});

/** GET /account/avatar-image — the signed-in member's own avatar for the account page. */
accountApp.get('/avatar-image', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active' || !c.env.AVATARS) return c.body(null, 404);
  const row = await c.env.DB_IDENTITY.prepare('SELECT avatar_key FROM profiles WHERE user_id = ?').bind(web.userId).first<{ avatar_key: string | null }>();
  const object = row?.avatar_key ? await c.env.AVATARS.get(row.avatar_key) : null;
  if (!object) return c.body(null, 404);
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'private, max-age=300' } });
});

/** POST /account/avatar — the page crops to a square and sends the image bytes. */
accountApp.post('/avatar', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false, message: '請重新登入。' }, 401);
  if (!c.env.AVATARS) return c.json({ ok: false, message: '頭像儲存尚未設定。' }, 503);
  if (Number(c.req.header('content-length') ?? '0') > MAX_AVATAR_BYTES) return c.json({ ok: false, message: '圖片太大，請換一張或縮小範圍。' }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const result = await setAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId: web.userId, bytes, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  if (!result.ok) return c.json({ ok: false, message: result.reason === 'too_large' ? '圖片太大，請換一張或縮小範圍。' : '只接受 PNG、JPEG 或 WebP 圖片。' }, result.reason === 'too_large' ? 413 : 415);
  return c.json({ ok: true });
});

/** POST /account/avatar/google — replaces the avatar with the member's Google photo. */
accountApp.post('/avatar/google', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false, message: '請重新登入。' }, 401);
  if (!c.env.AVATARS) return c.json({ ok: false, message: '頭像儲存尚未設定。' }, 503);
  const url = await googlePhotoOf(c.env.DB_IDENTITY, web.userId);
  if (!url) return c.json({ ok: false, message: '找不到 Google 頭像。請先綁定 Google 帳號，並重新用 Google 登入一次。' }, 404);
  const done = await importProviderAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), (u, init) => fetch(u, init), { userId: web.userId, url, appId: WEB_APP_ID, requestId: c.get('requestId'), replace: true }, Date.now());
  return done ? c.json({ ok: true }) : c.json({ ok: false, message: '無法取得 Google 頭像，請稍後再試。' }, 502);
});

/** POST /account/avatar/remove */
accountApp.post('/avatar/remove', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false, message: '請重新登入。' }, 401);
  if (c.env.AVATARS) await removeAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  return c.json({ ok: true });
});

/** POST /account/contact-email/verify — sends the confirmation link again. */
accountApp.post('/contact-email/verify', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const loaded = await loadProfile(c.env.DB_IDENTITY, web.userId);
  const email = loaded?.row.contact_email;
  if (!email || loaded.row.contact_email_verified_at !== null) return c.redirect('/account/profile', 303);
  const result = await sendContactEmailVerification(c.env.DATA_ENCRYPTION_KEY, mailSettings(c.env, new URL(c.req.url).origin), web.userId, email, Date.now());
  return c.redirect(`/account/profile?notice=${result === 'sent' ? 'verification_sent' : 'verification_unavailable'}`, 303);
});

/** GET /account/verify-email?t= — the link from the confirmation email; works without signing in. */
accountApp.get('/verify-email', async (c) => {
  const result = await confirmContactEmail(c.env.DB_IDENTITY, c.env.DATA_ENCRYPTION_KEY, c.req.query('t') ?? '', Date.now());
  const text: Record<ConfirmResult, string> = {
    verified: '聯絡信箱已確認，之後的系統通知會寄到這裡。',
    expired: '確認連結已過期，請到帳號中心的個人資料頁重寄確認信。',
    changed: '這個信箱已不是您目前的聯絡信箱，或連結已失效。',
    invalid: '確認連結無效。',
  };
  return c.html(page(c, '確認聯絡信箱', html`<h1>確認聯絡信箱</h1><div class="banner${result === 'verified' ? '' : ' danger'}">${text[result]}</div><p><a href="/account/profile">前往個人資料</a></p>`), result === 'verified' ? 200 : 400);
});

/** GET /account/motto-suggestion — random motto for the profile page (02.05); nothing is saved. */
accountApp.get('/motto-suggestion', (c) => {
  const web = c.get('web');
  if (!web) return c.json({ error: 'sign in' }, 401);
  return c.json({ motto: randomMotto(c.req.query('current') ?? null) });
});

// ---- Passkeys (WebAuthn) for the web account center ----

function relyingParty(c: WebContext): { origin: string; rpId: string } {
  const url = new URL(c.req.url);
  return { origin: url.origin, rpId: url.hostname };
}

/** The challenge sent to the browser is the single-use server nonce; the browser returns it base64url-encoded. */
async function consumeChallenge(c: WebContext, clientDataJSON: unknown, type: 'webauthn.create' | 'webauthn.get', now: number): Promise<boolean> {
  if (typeof clientDataJSON !== 'string' || clientDataJSON.length > 4096) return false;
  const data = readClientData(clientDataJSON, type, relyingParty(c));
  if (!data) return false;
  let nonce: string;
  try {
    nonce = fromUtf8(base64urlDecode(data.challenge));
  } catch {
    return false;
  }
  return consumeNonce(c.env.DB_IDENTITY, nonce, WEB_APP_ID, now);
}

const str = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);

accountApp.post('/passkey/register-options', async (c) => {
  const web = c.get('web');
  const requestId = c.get('requestId');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', requestId), 401);
  const now = Date.now();
  if (!isRecentLogin(web.createdAt, now)) return c.json(errorBody('REAUTH_REQUIRED', 'Sign in again before adding a passkey', requestId), 403);
  const db = c.env.DB_IDENTITY;
  const [existing, account] = await Promise.all([listPasskeys(db, web.userId), loadAccount(db, web.userId)]);
  const nonce = await issueNonce(db, WEB_APP_ID, now);
  const label = account?.profile.display_name ?? '繁星會員';
  return c.json({
    publicKey: {
      rp: { name: 'Starry', id: relyingParty(c).rpId },
      user: { id: base64urlEncode(utf8(web.userId)), name: label, displayName: label },
      challenge: base64urlEncode(utf8(nonce)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none',
      timeout: 120000,
      excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.credential_id })),
    },
  });
});

accountApp.post('/passkey/register', async (c) => {
  const web = c.get('web');
  const requestId = c.get('requestId');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', requestId), 401);
  const now = Date.now();
  if (!isRecentLogin(web.createdAt, now)) return c.json(errorBody('REAUTH_REQUIRED', 'Sign in again before adding a passkey', requestId), 403);
  const body = await readJsonObject(c);
  const attestation = str(body?.attestationObject, 8192);
  if (!body || !attestation || !(await consumeChallenge(c, body.clientDataJSON, 'webauthn.create', now))) return c.json(errorBody('BAD_REQUEST', 'This passkey request is invalid or expired', requestId), 400);
  const registered = await verifyRegistration(attestation, relyingParty(c));
  if (!registered) return c.json(errorBody('BAD_REQUEST', 'This passkey cannot be used', requestId), 400);
  const added = await addPasskey(c.env.DB_IDENTITY, { userId: web.userId, credentialId: registered.credentialId, key: registered.key, signCount: registered.signCount, name: typeof body.name === 'string' ? body.name : '', requestId }, now);
  if (added === 'limit') return c.json(errorBody('CONFLICT', `At most ${MAX_PASSKEYS} passkeys`, requestId), 409);
  if (added === 'duplicate') return c.json(errorBody('CONFLICT', 'This passkey is already registered', requestId), 409);
  return c.json({ ok: true });
});

accountApp.post('/passkey/login-options', async (c) => {
  const nonce = await issueNonce(c.env.DB_IDENTITY, WEB_APP_ID, Date.now());
  return c.json({ publicKey: { challenge: base64urlEncode(utf8(nonce)), rpId: relyingParty(c).rpId, userVerification: 'required', timeout: 120000, allowCredentials: [] } });
});

accountApp.post('/passkey/login', async (c) => {
  const requestId = c.get('requestId');
  const body = await readJsonObject(c);
  const id = str(body?.id, 1024);
  const authenticatorData = str(body?.authenticatorData, 2048);
  const signature = str(body?.signature, 1024);
  const clientDataJSON = str(body?.clientDataJSON, 4096);
  const refuse = () => c.json(errorBody('UNAUTHORIZED', 'Passkey sign-in failed', requestId), 401);
  if (!body || !id || !authenticatorData || !signature || !clientDataJSON) return c.json(errorBody('BAD_REQUEST', 'id, clientDataJSON, authenticatorData and signature are required', requestId), 400);
  const now = Date.now();
  if (!(await consumeChallenge(c, clientDataJSON, 'webauthn.get', now))) return refuse();
  const db = c.env.DB_IDENTITY;
  const stored = await findPasskey(db, id);
  if (!stored) return refuse();
  const result = await verifyAssertion({ clientDataJSON, authenticatorData, signature }, stored.key, stored.sign_count, relyingParty(c));
  if (!result.ok || !(await touchPasskey(db, id, stored.sign_count, result.signCount, now))) return refuse();
  const member = await db.prepare('SELECT status, session_version FROM users WHERE user_id = ?').bind(stored.user_id).first<{ status: string; session_version: number }>();
  if (!member) return refuse();
  if (member.status === 'suspended') return c.json(errorBody('ACCOUNT_SUSPENDED', 'Account suspended', requestId), 403);
  const session = await createWebSession(db, { userId: stored.user_id, sessionVersion: member.session_version, provider: 'passkey', deviceLabel: webDeviceLabel(c), requestId }, now);
  setCookie(c, SESSION_COOKIE, session.cookieValue, { prefix: 'host', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: Math.floor(WEB_SESSION_ABSOLUTE_MS / 1000) });
  return c.json({ ok: true });
});

accountApp.post('/passkey/:id/remove', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  await removePasskey(c.env.DB_IDENTITY, web.userId, c.req.param('id'), c.get('requestId'), Date.now());
  return c.redirect('/account?notice=passkey_removed', 303);
});

/** GET /account/export — the member downloads a JSON copy of their own data. */
accountApp.get('/export', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const now = Date.now();
  const data = await exportMemberData(c.env, web.userId, now);
  if (!data) return c.redirect('/account', 303);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="starry-my-data.json"', 'cache-control': 'no-store' },
  });
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
    <li>按下刪除後，帳號<strong>立即永久刪除</strong>，所有繁星 App 與裝置都會登出。</li>
    <li>個人資料、頭像、登入方式、客服紀錄與 Battery 都會一併刪除，<strong>無法復原</strong>。</li>
    <li>你的會員編號不會再發給任何人。</li>
    <li>刪除帳號不會自動取消 App Store 或 Google Play 的訂閱，請先到商店取消。</li>
  </ul>
  <form method="post" action="/account/delete">
    <label for="confirm">請輸入大寫英文 DELETE 以確認</label><input id="confirm" name="confirm" autocomplete="off" required>
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
  if (form.confirm?.trim() !== 'DELETE') return c.redirect('/account/delete', 303);
  const now = Date.now();
  const result = await deleteMemberNow(c.env.DB_IDENTITY, { userId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, now);
  deleteCookie(c, SESSION_COOKIE, { prefix: 'host', path: '/', secure: true });
  c.set('web', null);
  if (!result.ok) return c.redirect('/account', 303);
  await cleanupAfterDeletion(c.env, web.userId, result.avatarKey, now);
  return c.html(
    page(
      c,
      '帳號已刪除',
      html`<h1>帳號已刪除</h1>
<div class="card"><p>你的 Starry 帳號與資料已永久刪除，所有裝置都已登出。</p>
<p>如果你有訂閱，請記得到 App Store 或 Google Play 取消。</p></div>`,
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
