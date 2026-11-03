import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { APPLE_AUDIENCE, authBindings, GOOGLE_AUDIENCE, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const ORIGIN = 'https://api.test';
const WEB_APPLE_AUDIENCE = 'phd.starry.id.web';

describe('web account center, support form and Admin Lite', () => {
  let worker;
  let keys;

  before(async () => {
    keys = await authBindings();
    const audiences = { echo: { apple: [APPLE_AUDIENCE], google: [GOOGLE_AUDIENCE] }, account: { apple: [WEB_APPLE_AUDIENCE], google: [GOOGLE_AUDIENCE] } };
    worker = await startWorker({ bindings: { ...keys.bindings, AUTH_TEST_AUDIENCES: JSON.stringify(audiences), OWNER_CLAIM_CODE: 'owner-claim-test-code' } });
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  const form = (data, cookie, origin = ORIGIN) => ({
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(data).toString(),
  });
  const get = (cookie) => ({ redirect: 'manual', headers: cookie ? { cookie } : {} });

  async function webSignIn(sub) {
    const loginPage = await (await worker.call('/account')).text();
    const nonce = /"nonce":"([A-Za-z0-9_-]+)"/.exec(loginPage)?.[1];
    assert.ok(nonce, 'login page carries a server nonce');
    const idToken = await signJwt(keys.google, idTokenClaims('google', { sub, nonce, email: `${sub}@example.com` }));
    const res = await worker.call('/account/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ provider: 'google', id_token: idToken, nonce }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /^__Host-starry_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Lax/i);
    return setCookie.split(';')[0];
  }

  const jsonPost = (data, cookie) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(data),
  });
  const pageNonce = (html) => /"nonce":"([A-Za-z0-9_-]+)"/.exec(html)?.[1];
  const sessionIdOf = (cookie) => decodeURIComponent(cookie.split('=')[1]).split('.')[0];

  /** Native App sign-in for the same Google subject; returns the refresh token. */
  async function appSignIn(sub, deviceLabel) {
    const { nonce } = await (await worker.call('/v1/auth/nonce', jsonPost({ app_id: 'echo' }))).json();
    const idToken = await signJwt(keys.google, idTokenClaims('google', { sub, nonce }));
    const res = await worker.call('/v1/auth/google', jsonPost({ app_id: 'echo', id_token: idToken, nonce, device_label: deviceLabel }));
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()).refresh_token;
  }
  const refreshStatus = async (refreshToken) => (await worker.call('/v1/auth/refresh', jsonPost({ refresh_token: refreshToken }))).status;

  async function userIdOf(sub) {
    return (await worker.db.prepare("SELECT user_id FROM auth_identities WHERE provider = 'google' AND subject = ?").bind(sub).first()).user_id;
  }

  test('legal pages are public HTML with a strict CSP; the API gets no CSP', async () => {
    for (const path of ['/privacy', '/terms']) {
      const res = await worker.call(path);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
      assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    }
    assert.match(await (await worker.call('/privacy')).text(), /個人資料保護法/);
    assert.equal((await worker.call('/v1/health')).headers.get('content-security-policy'), null);
    const root = await worker.call('/', get());
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/account');
  });

  test('web sign-in sets a host-only cookie and shows the account with the consent prompt', async () => {
    const cookie = await webSignIn('web-user');
    const page = await (await worker.call('/account', get(cookie))).text();
    assert.match(page, /我的帳號/);
    assert.match(page, /請確認服務條款與隱私權政策/);
    assert.match(page, /web-user@example.com/);
    const consent = await worker.call('/account/consent', form({}, cookie));
    assert.equal(consent.status, 303);
    assert.doesNotMatch(await (await worker.call('/account', get(cookie))).text(), /請確認服務條款/);
  });

  test('cookie writes without a same-site Origin are refused', async () => {
    const cookie = await webSignIn('csrf-user');
    assert.equal((await worker.call('/account/consent', form({}, cookie, null))).status, 403);
    assert.equal((await worker.call('/account/consent', form({}, cookie, 'https://evil.example'))).status, 403);
  });

  test('profile edit uses the version and reports conflicts', async () => {
    const cookie = await webSignIn('profile-web');
    const ok = await worker.call('/account/profile', form({ version: '1', display_name: '網頁星', birthday: '1999-09-09', locale: 'zh-TW' }, cookie));
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /已儲存/);
    const stale = await worker.call('/account/profile', form({ version: '1', display_name: '舊', birthday: '', locale: 'zh-TW' }, cookie));
    assert.equal(stale.status, 409);
    const bad = await worker.call('/account/profile', form({ version: '2', display_name: '', birthday: '2999-01-01', locale: 'zh-TW' }, cookie));
    assert.equal(bad.status, 400);
  });

  test('deletion from the web ends the cookie session and can be cancelled after signing in again', async () => {
    const cookie = await webSignIn('web-delete');
    assert.equal((await worker.call('/account/delete', form({}, cookie))).status, 303, 'confirmation required');
    const res = await worker.call('/account/delete', form({ confirm: 'yes' }, cookie));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /已收到刪除申請/);
    assert.match(await (await worker.call('/account', get(cookie))).text(), /登入 Starry/, 'old cookie no longer works');
    const again = await webSignIn('web-delete');
    assert.match(await (await worker.call('/account', get(again))).text(), /撤回刪除申請/);
    assert.equal((await worker.call('/account/delete/cancel', form({}, again))).status, 303);
    const status = await worker.db.prepare('SELECT status FROM users WHERE user_id = ?').bind(await userIdOf('web-delete')).first();
    assert.equal(status.status, 'active');
  });

  test('support form accepts visitors and members, with validation', async () => {
    assert.equal((await worker.call('/support')).status, 200);
    const sent = await worker.call('/support', form({ category: 'report', app_id: 'echo', email: 'visitor@example.com', message: '有人發布不當內容' }));
    assert.equal(sent.status, 200);
    assert.match(await sent.text(), /案件編號/);
    const invalid = await worker.call('/support', form({ category: 'question', email: 'nope', message: 'x' }));
    assert.match(await invalid.text(), /Email 格式/);
    const cookie = await webSignIn('support-member');
    assert.equal((await worker.call('/support', form({ category: 'account', message: '無法加綁 Apple' }, cookie))).status, 200);
    const rows = (await worker.db.prepare('SELECT user_id, contact_email, category, app_id FROM support_tickets ORDER BY ticket_id').all()).results;
    assert.deepEqual(rows.map((r) => [r.contact_email, r.category, r.app_id]), [['visitor@example.com', 'report', 'echo'], [null, 'account', null]]);
    assert.equal(rows[1].user_id, await userIdOf('support-member'));
  });

  test('Admin Lite requires a staff role; admins suspend and restore members', async () => {
    const memberCookie = await webSignIn('plain-member');
    const plain = await worker.call('/admin', get(memberCookie));
    assert.equal(plain.status, 403);
    assert.equal((await worker.call('/admin', get())).status, 303, 'anonymous visitors go to sign-in');

    const adminCookie = await webSignIn('staff-admin');
    await worker.db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)").bind(await userIdOf('staff-admin'), Date.now()).run();
    assert.equal((await worker.call('/admin', get(adminCookie))).status, 200);
    const list = await (await worker.call('/admin/members', get(adminCookie))).text();
    assert.match(list, /p\*\*\*@example.com/, 'emails are masked');
    assert.doesNotMatch(list, /plain-member@example.com/);

    const target = await userIdOf('plain-member');
    const suspended = await worker.call(`/admin/members/${target}/suspend`, form({ reason: '測試停權' }, adminCookie));
    assert.equal(suspended.status, 200);
    assert.match(await suspended.text(), /已完成/);
    assert.match(await (await worker.call('/account', get(memberCookie))).text(), /登入 Starry/, 'suspension ends web sessions');
    const restored = await worker.call(`/admin/members/${target}/restore`, form({}, adminCookie));
    assert.match(await restored.text(), /已完成/);
    assert.equal((await worker.call(`/admin/members/${target}/role`, form({ role: 'admin' }, adminCookie))).status, 403, 'only the owner manages roles');
    assert.equal((await worker.call('/admin/audit', get(adminCookie))).status, 200);
    assert.equal((await worker.call('/admin/tickets', get(adminCookie))).status, 200);
  });

  test('an admin kill switch disables one App for sign-in and remote config', async () => {
    const adminCookie = await webSignIn('staff-killer');
    await worker.db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)").bind(await userIdOf('staff-killer'), Date.now()).run();
    const res = await worker.call('/admin/apps/echo/status', form({ status: 'killed', reason: '測試' }, adminCookie));
    assert.equal(res.status, 200);
    assert.equal((await (await worker.call('/v1/apps/echo/config')).json()).status, 'killed');
    const nonce = await worker.call('/v1/auth/nonce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: 'echo' }) });
    assert.equal(nonce.status, 403);
    await worker.call('/admin/apps/echo/status', form({ status: 'default' }, adminCookie));
    assert.equal((await (await worker.call('/v1/apps/echo/config')).json()).status, 'active');
  });

  test('owner claim works once with the configured passphrase', async () => {
    const cookie = await webSignIn('future-owner');
    assert.equal((await worker.call('/account/claim-owner', form({ code: 'wrong-passphrase' }, cookie))).status, 403);
    const ok = await worker.call('/account/claim-owner', form({ code: 'owner-claim-test-code' }, cookie));
    assert.equal(ok.status, 200);
    assert.equal((await worker.call('/admin', get(cookie))).status, 200);
    const other = await webSignIn('second-claimer');
    assert.equal((await worker.call('/account/claim-owner', form({ code: 'owner-claim-test-code' }, other))).status, 403);
  });

  test('API documentation is generated from the code and visible to admins only', async () => {
    const memberCookie = await webSignIn('docs-member');
    assert.equal((await worker.call('/admin/api', get(memberCookie))).status, 403);
    const adminCookie = await webSignIn('docs-admin');
    await worker.db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)").bind(await userIdOf('docs-admin'), Date.now()).run();
    const page = await worker.call('/admin/api', get(adminCookie));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /\/v1\/auth\/google/);
    const doc = await (await worker.call('/admin/api/openapi.json', get(adminCookie))).json();
    assert.equal(doc.openapi, '3.1.0');
    for (const path of ['/v1/health', '/v1/auth/nonce', '/v1/me', '/v1/me/profile', '/v1/me/entitlements', '/v1/billing/revenuecat/{appId}']) {
      assert.ok(doc.paths[path], path);
    }
    assert.equal(doc.paths['/admin/api'], undefined, 'web pages are not part of the API document');
    assert.ok(doc.components.securitySchemes.bearerAuth);
  });

  test('members see where they are signed in and can end one session or all of them (S-ID-05)', async () => {
    const cookie = await webSignIn('devices-user');
    const refreshToken = await appSignIn('devices-user', 'Pixel 9');
    let page = await (await worker.call('/account', get(cookie))).text();
    assert.match(page, /登入中的裝置/);
    assert.match(page, /Pixel 9/);
    assert.match(page, /目前這個瀏覽器/);
    const appSession = /action="\/account\/sessions\/([0-9a-f-]+)\/revoke"/.exec(page)?.[1];
    assert.ok(appSession, 'other sessions have a sign-out button');
    assert.notEqual(appSession, sessionIdOf(cookie));

    const stranger = await webSignIn('devices-stranger');
    const refused = await worker.call(`/account/sessions/${appSession}/revoke`, form({}, stranger));
    assert.equal(refused.headers.get('location'), '/account', 'cannot end another member\'s session');
    assert.equal(await refreshStatus(refreshToken), 200, 'still signed in after the refused attempt');

    const secondRefresh = await appSignIn('devices-user', 'iPad');
    page = await (await worker.call('/account', get(cookie))).text();
    const ipad = [...page.matchAll(/action="\/account\/sessions\/([0-9a-f-]+)\/revoke"/g)].map((m) => m[1]);
    assert.equal(ipad.length, 2);
    const revoke = await worker.call(`/account/sessions/${ipad[0]}/revoke`, form({}, cookie));
    assert.equal(revoke.status, 303);
    assert.equal(revoke.headers.get('location'), '/account?notice=session_revoked');
    assert.match(await (await worker.call('/account?notice=session_revoked', get(cookie))).text(), /已登出該裝置/);

    const third = await appSignIn('devices-user', 'Laptop');
    const all = await worker.call('/account/logout-all', form({}, cookie));
    assert.equal(all.status, 303);
    assert.equal(all.headers.get('location'), '/account?notice=logged_out_everywhere');
    assert.match(all.headers.get("set-cookie") ?? "", /__Host-starry_session=;|Max-Age=0/i);
    assert.match(await (await worker.call('/account', get(cookie))).text(), /登入 Starry/, 'this browser is signed out too');
    assert.match(await (await worker.call('/account?notice=logged_out_everywhere')).text(), /已登出所有裝置/);
    for (const token of [secondRefresh, third]) assert.equal(await refreshStatus(token), 401);
  });

  test('linking Apple from the web needs a recent login and refuses identities of other members (S-ID-02)', async () => {
    const cookie = await webSignIn('link-user');
    const account = await (await worker.call('/account', get(cookie))).text();
    assert.match(account, /加綁 Apple 登入方式/);
    const linkPage = await (await worker.call('/account/link', get(cookie))).text();
    assert.match(linkPage, /"endpoint":"\/account\/link"/);
    assert.match(linkPage, /綁定 Apple 帳號/);
    assert.doesNotMatch(linkPage, /google-button/, 'Google is already linked');
    const nonce = pageNonce(linkPage);
    const appleToken = await signJwt(keys.apple, idTokenClaims('apple', { sub: 'apple-link-1', nonce, aud: WEB_APPLE_AUDIENCE }));
    const res = await worker.call('/account/link', jsonPost({ provider: 'apple', id_token: appleToken, nonce, authorization_code: 'web-code' }, cookie));
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(await res.json(), { ok: true, result: 'linked' });
    const after = await (await worker.call('/account?notice=linked', get(cookie))).text();
    assert.match(after, /已加綁新的登入方式/);
    assert.match(after, /<li>Apple/);
    assert.doesNotMatch(after, /加綁.*登入方式<\/a>/);
    assert.match(await (await worker.call('/account/link', get(cookie))).text(), /已綁定所有可用的登入方式/);
    const exchange = await worker.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'apple.token_exchange' AND result = 'error'").first();
    assert.ok(exchange.n >= 1, 'without Apple keys the code exchange is skipped and audited, never blocking the link');

    const other = await webSignIn('link-other');
    const otherNonce = pageNonce(await (await worker.call('/account/link', get(other))).text());
    const stolen = await signJwt(keys.apple, idTokenClaims('apple', { sub: 'apple-link-1', nonce: otherNonce, aud: WEB_APPLE_AUDIENCE }));
    const taken = await worker.call('/account/link', jsonPost({ provider: 'apple', id_token: stolen, nonce: otherNonce }, other));
    assert.equal(taken.status, 409);
    assert.equal((await taken.json()).error.code, 'IDENTITY_IN_USE');

    await worker.db.prepare('UPDATE sessions SET created_at = created_at - 3600000 WHERE session_id = ?').bind(sessionIdOf(other)).run();
    const stale = await (await worker.call('/account/link', get(other))).text();
    assert.match(stale, /加綁前請重新登入/);
    assert.match(stale, /name="next" value="\/account\/link"/);
    const late = await worker.call('/account/link', jsonPost({ provider: 'apple', id_token: stolen, nonce: otherNonce }, other));
    assert.equal(late.status, 403);
    assert.equal((await late.json()).error.code, 'REAUTH_REQUIRED');
    const reauth = await worker.call('/account/logout', form({ next: '/account/link' }, other));
    assert.equal(reauth.headers.get('location'), '/account?next=%2Faccount%2Flink');
    assert.equal((await worker.call('/account/link', jsonPost({ provider: 'apple', id_token: stolen, nonce: otherNonce }))).status, 401);
  });

  test('the web login page sends the Apple authorization code for revocation', async () => {
    const page = await (await worker.call('/account')).text();
    assert.match(page, /apple-button/);
    assert.match(page, /authorization_code = code/);
    assert.match(page, /r\.authorization\.code/);
  });

  test('the web app id cannot be used by Apps, and web cookies are not refresh tokens', async () => {
    const res = await worker.call('/v1/auth/nonce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: 'account' }) });
    assert.equal(res.status, 400);
    const cookie = await webSignIn('cookie-as-refresh');
    const value = decodeURIComponent(cookie.split('=')[1]);
    const refresh = await worker.call('/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: value }) });
    assert.equal(refresh.status, 401);
  });
});
