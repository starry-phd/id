import { deleteCookie } from 'hono/cookie';
import { BATTERY_ICON } from '../lib/battery-icons';
import { html } from 'hono/html';
import { getBalance, recentActivity } from '../battery/battery';
import { codeInfo, normalizeCode, redeemInvite } from '../battery/invites';
import { listQuantum } from '../battery/quantum';
import { getNotices } from '../lib/notices';
import { activeScopedNotices } from '../lib/scoped-notices';
import type { Provider } from '../auth/provider-keys';
import { isCategory, setPreferences } from '../notify/push';
import { background, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import { rememberAppleToken } from '../identity/apple';
import { listActiveSessions, logoutEverywhere, revokeAppSessions, revokeOwnSession } from '../identity/devices';
import { importProviderAvatar, r2Store, rememberProviderPhoto } from '../identity/avatars';
import { linkIdentity, type LinkResult } from '../identity/link';
import { completeMerge, findMergeCandidate, type MergeBlocker } from '../identity/merge';
import { acceptConsents, consentRequired } from '../identity/members';
import { derivedOf } from '../identity/profile';
import { issueNonce } from '../identity/nonces';
import { listPasskeys, MAX_PASSKEYS } from '../identity/passkeys';
import { hasRole, isRecentLogin, listAppStaffApps, roleOf } from '../identity/roles';
import { memberSubscriptions } from '../billing/revenuecat';
import { appRegistry, getApp } from '../apps/registry';
import { WEB_APP_ID } from '../identity/web-sessions';
import { errorBody } from '../lib/errors';
import { open as unseal, seal } from '../lib/sealed';
import { readJsonObject } from '../lib/validate';
import { formatTime, page, readForm, SESSION_COOKIE, type Html, type WebContext } from './layout';
import { LOCALES, NOTICES, PROVIDER_NAMES, accountApp, appLabel, appleRedirectUri, linkableProviders, loadAccount, loginPage, passkeyScript, providerWidgets, webApp } from './account-lib';
import { countryName } from './account-profile';
import { initialsOf } from '../identity/initials';
import { avatarBubble } from './member-nav';

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
  const app = await webApp(c);
  const linkable = app ? linkableProviders(c, app, account.identities.map((i) => i.provider)) : { google: null, apple: null };
  const sessions = await listActiveSessions(db, web.userId, now);
  const passkeys = await listPasskeys(db, web.userId);
  const managedApps = await listAppStaffApps(db, web.userId);
  const supportApps = await listAppStaffApps(db, web.userId, 'support');
  const inviteMsg = ({ ok: '兌換成功，已加入 ⚛️ 量子電池。', ok_battery: '兌換成功，已加入本月的 🔋 電池額度。', invalid: '序號不正確、已停用或已過期。', already: '你已經兌換過這組序號。', used_up: '這組序號已被領完。', error: '暫時無法兌換，請稍後再試；序號沒有被用掉。' } as Record<string, string>)[c.req.query('invite') ?? ''] ?? '';
  const subscriptions = await memberSubscriptions(c.env.DB_BILLING, web.userId, now).catch(() => []);
  const signedInApps = [...new Set(sessions.map((s) => s.appId))].filter((a) => a !== WEB_APP_ID);
  const [battery, batteryActivity, quantum] = await Promise.all([getBalance(c.env.DB_BATTERY, web.userId, now), recentActivity(c.env.DB_BATTERY, web.userId, now, { limit: 10 }), listQuantum(c.env.DB_BATTERY, web.userId)]);
  const notices = await getNotices(db);
  const timed = await activeScopedNotices(db, now).catch(() => []);
  const memberNo = (await db.prepare('SELECT member_no FROM users WHERE user_id = ?').bind(web.userId).first<{ member_no: string | null }>())?.member_no ?? null;
  const location = [countryName(p.country), p.region, p.city].filter((v) => v).join(' ');
  const body = html`<div class="hero">${avatarBubble({ initials: initialsOf(p.display_name ?? p.nickname), photo: p.avatar_key ? '/account/avatar-image' : null, size: 72, label: p.display_name ?? '' })}<div><h1>${p.display_name ?? '我的帳號'}</h1>${memberNo ? html`<span class="badge">${memberNo}</span>` : ''}</div></div>
${notices.maintenance ? html`<div class="banner danger">系統維護中：${notices.maintenanceMessage || 'AI 功能暫時停用，帳號功能可正常使用。'}</div>` : ''}
${notices.announcement ? html`<div class="banner">${notices.announcement}</div>` : ''}
${timed.map((n) => html`<div class="banner">${n.message}</div>`)}
${notice ? html`<div class="banner">${notice}</div>` : ''}
${needsConsent
  ? html`<div class="banner"><strong>請確認服務條款與隱私權政策</strong><br>請閱讀<a href="/terms">服務條款</a>與<a href="/privacy">隱私權政策</a>（版本 ${c.env.TERMS_VERSION}／${c.env.PRIVACY_VERSION}）。
<form method="post" action="/account/consent"><button type="submit">我已閱讀並同意</button></form></div>`
  : ''}
${battery && batteryActivity
  ? html`<div class="statrow" id="battery">
  <div class="statbox"><b>${battery.remaining}</b><span>${BATTERY_ICON.normal} 電池（共 ${battery.allowance}）</span></div>
  <div class="statbox"><b>${quantum.reduce((sum, q) => sum + q.available, 0)}</b><span>${BATTERY_ICON.quantum} 量子電池</span></div>
</div>
<div class="card">
  <form method="post" action="/account/redeem"><label for="invite-code">兌換序號</label><input id="invite-code" name="code" maxlength="40" autocomplete="off" required><button type="submit">兌換</button></form>
  ${inviteMsg ? html`<div class="banner">${inviteMsg}</div>` : ''}
  ${quantum.length > 0 ? html`<table><tr><th>App</th><th>${BATTERY_ICON.quantum} 量子電池</th></tr>${quantum.map((q) => html`<tr><td>${appLabel(q.app_id)}</td><td>${q.available}</td></tr>`)}</table>` : ''}
  ${batteryActivity.entries.length > 0
    ? html`<details class="fold"><summary>用量紀錄</summary><table><tr><th>時間</th><th>項目</th><th>數量</th></tr>${batteryActivity.entries.map(
        (e) => html`<tr><td>${formatTime(e.created_at)}</td><td>${e.kind === 'usage' ? (e.task_label ?? appLabel(e.app_id ?? '')) : '客服調整'}</td><td>${e.kind === 'usage' ? `-${e.amount}` : e.amount > 0 ? `+${e.amount}` : `${e.amount}`}</td></tr>`,
      )}</table></details>`
    : ''}
</div>`
  : ''}
<div class="card">
  <p><strong>聯絡 Email</strong> ${p.contact_email ?? '—'}${p.contact_email && !p.contact_email_verified_at ? ' （待確認）' : ''}<br>
  <strong>手機</strong> ${p.phone ?? '—'}<br>
  <strong>地區</strong> ${location || '—'}<br>
  <strong>生日</strong> ${p.birthday ? html`${p.birthday}（${derivedOf(p.birthday)?.zodiac_name ?? ''}）` : '—'}<br>
  <strong>座右銘</strong> ${p.motto ?? '—'}<br>
  <strong>語系</strong> ${LOCALES[p.locale] ?? p.locale}<br>
  <strong>加入時間</strong> ${formatTime(account.createdAt)}</p>
  <a class="button" href="/account/profile">編輯關於我</a>
</div>
${supportApps.length > 0 ? html`<div class="card"><strong>客服</strong> ${supportApps.map((a) => appLabel(a)).join('、')}<div class="actions"><a class="button secondary" href="/admin/tickets">客服單</a><a class="button secondary" href="/admin/members">會員</a></div></div>` : ''}
${managedApps.length > 0 ? html`<div class="card"><strong>我管理的 App</strong><ul>${managedApps.map((a) => html`<li>${appLabel(a)}：<a href="/admin/apps/${a}/config">遠端設定</a></li>`)}</ul></div>` : ''}
${html`<details class="card fold"><summary>登入方式與安全</summary>
  <ul>${account.identities.map((i) => html`<li>${PROVIDER_NAMES[i.provider] ?? i.provider}${i.email ? html`：${i.email}` : ''}</li>`)}</ul>
  ${linkable.google || linkable.apple ? html`<a class="button secondary" href="/account/link">加綁${linkable.apple && linkable.google ? '其他' : linkable.apple ? ' Apple ' : ' Google '}登入方式</a>` : ''}
  <h3>Passkey</h3>
  ${passkeys.length > 0 ? html`<ul>${passkeys.map((k) => html`<li>${k.name}（${formatTime(k.created_at)}）<form class="inline" method="post" action="/account/passkey/${k.credential_id}/remove"><button class="secondary" type="submit">移除</button></form></li>`)}</ul>` : ''}
  ${passkeys.length < MAX_PASSKEYS ? html`<button id="add-passkey" type="button">新增 Passkey</button><p id="passkey-error" class="danger" role="alert"></p>` : ''}
</details>
<details class="card fold"><summary>登入紀錄</summary>
  ${signedInApps.length > 0 ? html`<div class="chips">${signedInApps.map((a) => html`<span class="badge">${appLabel(a)}</span>`)}</div>` : ''}
  <table>
    <tr><th>App</th><th>裝置</th><th>最後使用</th><th></th></tr>
    ${sessions.map(
      (s) => html`<tr><td>${appLabel(s.appId)}</td><td>${s.deviceLabel ?? '—'}</td><td>${formatTime(s.lastUsedAt)}</td><td>${s.sessionId === web.sessionId
        ? html`<span class="badge">此瀏覽器</span>`
        : html`<form class="inline" method="post" action="/account/sessions/${s.sessionId}/revoke"><button class="secondary" type="submit">登出</button></form>`}</td></tr>`,
    )}
  </table>
  <form method="post" action="/account/logout-all"><button class="secondary" type="submit">登出所有裝置</button></form>
</details>`}
${subscriptions.length > 0
  ? html`<details class="card fold"><summary>我的訂閱與購買</summary><table><tr><th>App</th><th>權益</th><th>到期</th></tr>${subscriptions.map((x) => html`<tr><td>${appLabel(x.app_id)}</td><td>${x.entitlement}</td><td>${x.expires_at ? formatTime(x.expires_at) : '長期有效'}</td></tr>`)}</table></details>`
  : ''}
<div class="actions">
  <a class="button secondary" href="/account/notifications">通知設定</a>
  <a class="button secondary" href="/account/export">下載我的資料</a>
  ${role && hasRole(role, 'support') ? html`<a class="button" href="/admin">Admin Lite</a>` : ''}
  <a class="button secondary" href="/account/delete">刪除帳號</a>
</div>
<form method="post" action="/account/logout"><button class="secondary" type="submit">登出</button></form>`;
  return c.html(page(c, '我的帳號', body, { scripts: passkeyScript(c, 'register') }));
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

/** POST /account/apps/:app/logout — ends every session of this member in one App; the web session stays. */
accountApp.post('/apps/:app/logout', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const appId = c.req.param('app');
  if (!getApp(appId)) return c.redirect('/account', 303);
  const count = await revokeAppSessions(c.env.DB_IDENTITY, { userId: web.userId, requestId: c.get('requestId') }, appId, Date.now());
  return c.redirect(count > 0 ? '/account?notice=app_logged_out' : '/account', 303);
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
      html`<div class="card">${widgets.body}</div>`,
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

/** The link form of a code: signs the member in when needed, shows what it gives, and redeems on one button press (a link preview never redeems). */
accountApp.get('/redeem/:code', async (c) => {
  const code = normalizeCode(c.req.param('code'));
  const web = c.get('web');
  if (!/^[A-Z0-9]{6,32}$/.test(code)) return c.redirect('/account', 303);
  if (!web || web.status !== 'active') return c.redirect(`/account?next=${encodeURIComponent(`/account/redeem/${code}`)}`, 303);
  const info = await codeInfo(c.env.DB_BATTERY, code, Date.now());
  return c.html(
    page(
      c,
      '兌換序號',
      html`<h1>兌換序號</h1>
${info ? html`<div class="card"><p>這組序號可領取：<strong>${info.units}</strong> 顆${info.kind === 'battery' ? '🔋 電池（全部 App 共用，只加本月額度）' : info.appId ? html`⚛️ 量子電池（只能在「${getApp(info.appId)?.name ?? info.appId}」使用）` : '⚛️ 量子電池（請選一款 App，兌換後只能在那一款 App 使用，之後不能更改）'}</p>
<form method="post" action="/account/redeem"><input type="hidden" name="code" value="${code}">${info.kind === 'quantum' && !info.appId ? html`<label for="app_id">要用在哪一款 App</label><select id="app_id" name="app_id" required><option value="">請選擇</option>${[...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID).map((a) => html`<option value="${a.app_id}">${a.name}</option>`)}</select>` : ''}<button type="submit">兌換</button></form></div>` : html`<div class="banner danger">序號不正確、已停用、已過期或已被領完。</div>`}
<p><a href="/account">回到帳號中心</a></p>`,
    ),
  );
});

accountApp.post('/redeem', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const form = await readForm(c);
  const chosen = form.app_id ? getApp(form.app_id) : null;
  const result = await redeemInvite(c.env.DB_BATTERY, web.userId, form.code ?? '', Date.now(), chosen && chosen.app_id !== WEB_APP_ID ? chosen.app_id : null);
  // A universal code typed on the account page still needs the App: send the member to the link page that asks for it.
  if (!result.ok && result.reason === 'need_app') return c.redirect(`/account/redeem/${normalizeCode(form.code ?? '')}`, 303);
  return c.redirect(`/account?invite=${result.ok ? (result.kind === 'battery' ? 'ok_battery' : 'ok') : result.reason}`, 303);
});

accountApp.post('/consent', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  await acceptConsents(c.env.DB_IDENTITY, { userId: web.userId, termsVersion: c.env.TERMS_VERSION, privacyVersion: c.env.PRIVACY_VERSION, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  return c.redirect('/account', 303);
});

interface PreferenceRow {
  app_id: string;
  category: string;
  enabled: number;
}

async function notificationsPage(c: WebContext, userId: string, message?: string): Promise<Response> {
  const rows = await c.env.DB_IDENTITY.prepare('SELECT app_id, category, enabled FROM push_preferences WHERE user_id = ? ORDER BY app_id, category LIMIT 200').bind(userId).all<PreferenceRow>();
  const form =
    rows.results.length === 0
      ? html`<p class="muted">目前沒有可調整的通知項目。App 開始傳送通知類別後，會出現在這裡。</p>`
      : html`<form method="post" action="/account/notifications"><input type="hidden" name="n" value="${String(rows.results.length)}">
${rows.results.map(
  (r, i) => html`<input type="hidden" name="key_${String(i)}" value="${r.app_id}|${r.category}"><label><input type="checkbox" name="on_${String(i)}" value="1" ${r.enabled === 1 ? 'checked' : ''}> ${appLabel(r.app_id)}：${r.category}</label>`,
)}
<button type="submit">儲存</button></form>`;
  return c.html(page(c, '通知設定', html`<h1>通知設定</h1>${message ? html`<div class="banner">${message}</div>` : ''}<div class="card">${form}</div><p><a href="/account">回到帳號中心</a></p>`));
}

accountApp.get('/notifications', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  return notificationsPage(c, web.userId);
});

accountApp.post('/notifications', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const form = await readForm(c);
  const count = Math.min(Number.parseInt(form.n ?? '0', 10) || 0, 200);
  const byApp = new Map<string, Record<string, boolean>>();
  for (let i = 0; i < count; i++) {
    const [appId, category] = (form[`key_${i}`] ?? '').split('|');
    if (!appId || !isCategory(category)) continue;
    byApp.set(appId, { ...byApp.get(appId), [category]: form[`on_${i}`] === '1' });
  }
  const known = new Set((await c.env.DB_IDENTITY.prepare("SELECT app_id || '|' || category AS k FROM push_preferences WHERE user_id = ?").bind(web.userId).all<{ k: string }>()).results.map((r) => r.k));
  const now = Date.now();
  for (const [appId, choices] of byApp) {
    const allowed = Object.fromEntries(Object.entries(choices).filter(([category]) => known.has(`${appId}|${category}`)));
    await setPreferences(c.env.DB_IDENTITY, web.userId, appId, allowed, now);
  }
  return notificationsPage(c, web.userId, '已儲存。');
});
