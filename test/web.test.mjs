import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { APPLE_AUDIENCE, authBindings, GOOGLE_AUDIENCE, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const ORIGIN = 'https://api.test';

describe('web account center, support form and Admin Lite', () => {
  let worker;
  let keys;

  before(async () => {
    keys = await authBindings();
    const audiences = { echo: { apple: [APPLE_AUDIENCE], google: [GOOGLE_AUDIENCE] }, account: { apple: [], google: [GOOGLE_AUDIENCE] } };
    worker = await startWorker({ bindings: { ...keys.bindings, AUTH_TEST_AUDIENCES: JSON.stringify(audiences) } });
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

  test('the web app id cannot be used by Apps, and web cookies are not refresh tokens', async () => {
    const res = await worker.call('/v1/auth/nonce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: 'account' }) });
    assert.equal(res.status, 400);
    const cookie = await webSignIn('cookie-as-refresh');
    const value = decodeURIComponent(cookie.split('=')[1]);
    const refresh = await worker.call('/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: value }) });
    assert.equal(refresh.status, 401);
  });
});
