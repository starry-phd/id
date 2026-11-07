import { deleteCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { getBalance, recentActivity } from '../battery/battery';
import { redeemInvite } from '../battery/invites';
import { listQuantum } from '../battery/quantum';
import { getNotices } from '../lib/notices';
import type { Provider } from '../auth/provider-keys';
import { background, readProviderRequest, verifyProviderRequest } from '../auth/routes';
import { rememberAppleToken } from '../identity/apple';
import { listActiveSessions, logoutEverywhere, revokeOwnSession } from '../identity/devices';
import { importProviderAvatar, r2Store, rememberProviderPhoto } from '../identity/avatars';
import { DELETION_GRACE_MS } from '../identity/lifecycle';
import { linkIdentity, type LinkResult } from '../identity/link';
import { completeMerge, findMergeCandidate, type MergeBlocker } from '../identity/merge';
import { acceptConsents, consentRequired } from '../identity/members';
import { derivedOf } from '../identity/profile';
import { issueNonce } from '../identity/nonces';
import { listPasskeys, MAX_PASSKEYS } from '../identity/passkeys';
import { hasRole, isRecentLogin, listAppStaffApps, roleOf } from '../identity/roles';
import { WEB_APP_ID } from '../identity/web-sessions';
import { errorBody } from '../lib/errors';
import { open as unseal, seal } from '../lib/sealed';
import { readJsonObject } from '../lib/validate';
import { formatTime, page, readForm, SESSION_COOKIE, type Html, type WebContext } from './layout';
import { LOCALES, NOTICES, PROVIDER_NAMES, accountApp, appLabel, appleRedirectUri, linkableProviders, loadAccount, loginPage, passkeyScript, providerWidgets, webApp } from './account-lib';
import { countryName } from './account-profile';

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
