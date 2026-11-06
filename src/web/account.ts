import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import { audiencesFor, getApp, type AppEntry } from '../apps/registry';
import { getBalance, recentActivity } from '../battery/battery';
import { withEffectiveStatus } from '../apps/status';
import type { Provider } from '../auth/provider-keys';
import { background, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import type { AppBindings } from '../env';
import { rememberAppleToken } from '../identity/apple';
import { mailSettings } from '../notify/email';
import { listActiveSessions, logoutEverywhere, revokeOwnSession } from '../identity/devices';
import { importProviderAvatar, r2Store } from '../identity/avatars';
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
import { issueNonce } from '../identity/nonces';
import { claimOwner, hasRole, isRecentLogin, roleOf } from '../identity/roles';
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
  note.textContent = '合併後只保留目前這個帳號，之後用 Apple 或 Google 都會登入這裡。另一個帳號的客服紀錄會移過來；它的個人資料、同意紀錄與 Battery 使用紀錄會刪除，用它登入的裝置會被登出。';
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
  const { member, isNew } = await findOrCreateMember(db, verified.identity, { appId: WEB_APP_ID, requestId, country: c.req.header('cf-ipcountry') }, now);
  if (member.status === 'suspended') return c.json(errorBody('ACCOUNT_SUSPENDED', 'Account suspended', requestId), 403);
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
  const [battery, batteryActivity] = pending
    ? [null, null]
    : await Promise.all([getBalance(c.env.DB_BATTERY, web.userId, now), recentActivity(c.env.DB_BATTERY, web.userId, now, { limit: 10 })]);
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
</div>`
  : ''}
${role && hasRole(role, 'support') ? html`<p><a class="button" href="/admin">進入 Admin Lite</a></p>` : ''}
${pending ? '' : html`<h2>刪除帳號</h2><p class="muted">確認後立即永久刪除，無法復原。</p><a href="/account/delete">申請刪除帳號</a>`}`;
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
  input: 'text' | 'email' | 'tel' | 'date' | 'country' | 'locale' | 'textarea';
  max?: number;
  hint?: string;
}

const PROFILE_FIELDS: readonly FieldSpec[] = [
  { field: 'display_name', label: '姓名', eye: 'display_name', input: 'text', max: 50, hint: '其他會員看到的名字，1～50 字。' },
  { field: 'contact_email', label: '主要聯絡 Email', eye: 'contact_email', input: 'email', hint: '變更後會寄確認信；確認前，系統通知仍寄到登入用的信箱。' },
  { field: 'phone', label: '手機（選填）', eye: 'phone', input: 'tel', hint: '可輸入 0912345678，會依國家自動加上國碼。預設不公開。' },
  { field: 'country', label: '國家／地區', eye: 'location', input: 'country', hint: '這裡的公開設定同時套用到省／州／縣市與城市。' },
  { field: 'region', label: '省／州／縣市', eye: null, input: 'text', max: 60 },
  { field: 'city', label: '城市／鄉鎮區', eye: null, input: 'text', max: 60 },
  { field: 'birthday', label: '生日', eye: 'birthday', input: 'date', hint: '公開時只顯示月日；未滿 18 歲不會公開。' },
  { field: 'motto', label: '座右銘', eye: 'motto', input: 'textarea', max: 200 },
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
<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${spec.label}</strong><span>${spec.eye ? eyeForm(spec.eye, visibility, p.version, locked) : ''}<button class="secondary pencil" type="button" aria-label="編輯${spec.label}" hidden>✏️ 編輯</button></span></div>
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
<div class="card field"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>頭像</strong>${eyeForm('avatar', visibility, p.version, false)}</div><p class="muted">頭像請在繁星 App 內上傳與裁切；沒有頭像時顯示姓名第一個字。</p>${updatedLine(loaded.fieldUpdates, 'avatar')}</div>
${rows}
<h2>生日資訊</h2>
${derivedCard(p, visibility, p.version, minor)}
<p><a href="/account">回到帳號中心</a></p>`,
    {
      scripts: html`<script nonce="${nonce}">
document.documentElement.classList.add('js');
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
