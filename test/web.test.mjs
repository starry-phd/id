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

  /** A multipart/form-data body built by hand, as a browser would send the support form. */
  function multipart(fields, file) {
    const boundary = `----starry-test-${Math.random().toString(16).slice(2)}`;
    const parts = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    if (file) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.bytes, Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  test('support attachments are checked by content, stored privately and downloadable by staff only (S-WEB-02)', async () => {
    const formPage = await (await worker.call('/support')).text();
    assert.match(formPage, /enctype="multipart\/form-data"/);
    assert.match(formPage, /name="attachment"/);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
    const post = (fields, file) => {
      const body = multipart(fields, file);
      return worker.call('/support', { method: 'POST', redirect: 'manual', headers: { 'content-type': body.contentType, origin: ORIGIN }, body: body.body });
    };
    const fields = { category: 'account', email: 'attach@example.com', message: '登入錯誤截圖' };
    const disguised = await post(fields, { name: 'shot.png', type: 'image/png', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    assert.match(await disguised.text(), /附件只接受/);
    const big = Buffer.alloc(2 * 1024 * 1024 + 1);
    png.copy(big);
    assert.match(await (await post(fields, { name: 'big.png', type: 'image/png', bytes: big })).text(), /附件超過 2 MB/);
    assert.equal(await worker.db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE contact_email = 'attach@example.com'").first('n'), 0, 'rejected files create no ticket');

    const sent = await post(fields, { name: 'shot.png', type: 'image/png', bytes: png });
    assert.equal(sent.status, 200);
    const done = await sent.text();
    assert.match(done, /案件編號/);
    assert.doesNotMatch(done, /附件沒有上傳成功/);
    const row = await worker.db
      .prepare("SELECT a.ticket_id, a.attachment_id, a.object_key, a.content_type, a.size_bytes FROM support_attachments a JOIN support_tickets t ON t.ticket_id = a.ticket_id WHERE t.contact_email = 'attach@example.com'")
      .first();
    assert.deepEqual([row.content_type, row.size_bytes], ['image/png', png.length]);
    const stored = await (await worker.mf.getR2Bucket('SUPPORT_FILES')).get(row.object_key);
    assert.deepEqual(Buffer.from(await stored.arrayBuffer()), png);

    const url = `/admin/tickets/${row.ticket_id}/attachments/${row.attachment_id}`;
    assert.equal((await worker.call(url, get())).status, 303, 'visitors are sent to sign in');
    assert.equal((await worker.call(url, get(await webSignIn('attach-member')))).status, 403, 'members without a staff role are refused');
    const support = await webSignIn('attach-support');
    await worker.db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'support', ?)").bind(await userIdOf('attach-support'), Date.now()).run();
    assert.ok((await (await worker.call(`/admin/tickets/${row.ticket_id}`, get(support))).text()).includes(url), 'the ticket page links the file');
    const download = await worker.call(url, get(support));
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'image/png');
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment; filename="ticket-[0-9a-f]{8}\.png"$/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
    assert.equal((await worker.call(`/admin/tickets/01900000-0000-7000-8000-000000000000/attachments/${row.attachment_id}`, get(support))).status, 404);

    // Without the EMAIL binding replies are not offered and nothing is sent (S-NTF-02).
    assert.match(await (await worker.call(`/admin/tickets/${row.ticket_id}`, get(support))).text(), /系統 Email 尚未啟用/);
    const reply = await worker.call(`/admin/tickets/${row.ticket_id}/reply`, form({ reply: '您好，已收到。' }, support));
    assert.match(await reply.text(), /系統 Email 尚未啟用/);
    assert.equal(await worker.db.prepare('SELECT COUNT(*) AS n FROM support_ticket_replies').first('n'), 0);
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

  test('Battery in Admin Lite: admins adjust a member, only the owner sets policy and task costs (S-BAT-02/05)', async () => {
    const memberCookie = await webSignIn('battery-member');
    const target = await userIdOf('battery-member');
    let account = await (await worker.call('/account', get(memberCookie))).text();
    assert.match(account, /Starry Battery/);
    assert.match(account, /本月剩餘 <strong>10<\/strong> 顆/);

    const adminCookie = await webSignIn('battery-admin');
    await worker.db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'admin', ?)").bind(await userIdOf('battery-admin'), Date.now()).run();
    assert.match(await (await worker.call('/admin/battery', get(adminCookie))).text(), /只有 Owner 可以修改/);
    assert.equal((await worker.call('/admin/battery/policy', form({ allowance: '500', timeout: '60' }, adminCookie))).status, 403, 'admins cannot change the policy');
    assert.match(await (await worker.call(`/admin/members/${target}`, get(adminCookie))).text(), /調整本月額度/);
    const refused = await worker.call(`/admin/members/${target}/battery`, form({ delta: '20', reason: '' }, adminCookie));
    assert.match(await refused.text(), /請填寫非 0 的整數/);
    const adjusted = await worker.call(`/admin/members/${target}/battery`, form({ delta: '20', reason: '補償' }, adminCookie));
    assert.match(await adjusted.text(), /已調整，本月額度現為 30 顆/);
    const self = await worker.call(`/admin/members/${await userIdOf('battery-admin')}/battery`, form({ delta: '20', reason: '自己' }, adminCookie));
    assert.match(await self.text(), /不能調整自己的 Battery/);
    account = await (await worker.call('/account', get(memberCookie))).text();
    assert.match(account, /本月剩餘 <strong>30<\/strong>/);
    assert.match(account, /客服調整/);
    assert.doesNotMatch(account, /補償/, 'members never see the staff reason');
    assert.equal(await worker.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.battery_adjusted'").first('n'), 1);

    const ownerCookie = await webSignIn('battery-owner');
    await worker.db.prepare("INSERT INTO user_roles (user_id, role, granted_at) VALUES (?, 'owner', ?)").bind(await userIdOf('battery-owner'), Date.now()).run();
    const policy = await worker.call('/admin/battery/policy', form({ allowance: '150', timeout: '120' }, ownerCookie));
    assert.match(await policy.text(), /已更新每月額度/);
    const task = await worker.call('/admin/battery/tasks', form({ app_id: 'echo', name: 'transcribe', label: '語音轉文字', unit_cost: '2', max_units: '30', timeout: '', enabled: '1' }, ownerCookie));
    const taskPage = await task.text();
    assert.match(taskPage, /已儲存 echo.transcribe/);
    assert.match(taskPage, /語音轉文字/);
    const bad = await worker.call('/admin/battery/tasks', form({ app_id: 'account', name: 'x1', label: 'x', unit_cost: '1', max_units: '1' }, ownerCookie));
    assert.match(await bad.text(), /請選擇 App/);
    assert.match(await (await worker.call('/account', get(memberCookie))).text(), /本月剩餘 <strong>170<\/strong>/, 'a new monthly allowance applies this month too');
    // The owner-claim test below needs a database without an owner.
    await worker.db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(await userIdOf('battery-owner')).run();
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
    assert.doesNotMatch(linkPage, /<div id="google-button">/, "Google is already linked");
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
    const takenBody = await taken.json();
    assert.equal(takenBody.error.code, 'IDENTITY_IN_USE');
    assert.equal(takenBody.merge_blocked, 'other_sign_in', 'an account that also has Google is never merged away');
    assert.equal(takenBody.merge, undefined);

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

  test('Google and Apple used separately: linking offers to merge the duplicate account', async () => {
    const main = await webSignIn('merge-google');
    const mainId = await userIdOf('merge-google');
    // The same person signs in with Apple on the web, which creates a second Starry account.
    const loginNonce = pageNonce(await (await worker.call('/account')).text());
    const appleLogin = await signJwt(keys.apple, idTokenClaims('apple', { sub: 'merge-apple', nonce: loginNonce, aud: WEB_APPLE_AUDIENCE }));
    const dupSession = await worker.call('/account/session', jsonPost({ provider: 'apple', id_token: appleLogin, nonce: loginNonce }));
    assert.equal(dupSession.status, 200);
    const dupCookie = (dupSession.headers.get('set-cookie') ?? '').split(';')[0];
    const dupId = (await worker.db.prepare("SELECT user_id FROM auth_identities WHERE provider = 'apple' AND subject = 'merge-apple'").first()).user_id;
    assert.notEqual(dupId, mainId);
    assert.equal((await worker.call('/support', form({ category: 'account', message: '我有兩個帳號' }, dupCookie))).status < 400, true);

    const linkPage = await (await worker.call('/account/link', get(main))).text();
    assert.match(linkPage, /merge-offer/);
    const nonce = pageNonce(linkPage);
    const appleToken = await signJwt(keys.apple, idTokenClaims('apple', { sub: 'merge-apple', nonce, aud: WEB_APPLE_AUDIENCE }));
    const offer = await worker.call('/account/link', jsonPost({ provider: 'apple', id_token: appleToken, nonce }, main));
    assert.equal(offer.status, 409);
    const { merge } = await offer.json();
    assert.equal(merge.provider, 'apple');
    assert.equal(typeof merge.ticket, 'string');
    assert.equal(typeof merge.created_at, 'number');
    assert.doesNotMatch(merge.ticket, new RegExp(dupId), 'the other member ID stays sealed');

    assert.equal((await worker.call('/account/link/merge', jsonPost({ ticket: 'v1.x.y' }, main))).status, 400);
    const stranger = await webSignIn('merge-stranger');
    assert.equal((await worker.call('/account/link/merge', jsonPost({ ticket: merge.ticket }, stranger))).status, 400, 'a ticket only works for the member who proved both sign-ins');
    const done = await worker.call('/account/link/merge', jsonPost({ ticket: merge.ticket }, main));
    assert.equal(done.status, 200, await done.clone().text());
    assert.deepEqual(await done.json(), { ok: true, result: 'merged' });
    assert.equal((await worker.call('/account/link/merge', jsonPost({ ticket: merge.ticket }, main))).status, 409, 'a ticket works once');

    const page = await (await worker.call('/account?notice=merged', get(main))).text();
    assert.match(page, /已合併帳號/);
    assert.match(page, /<li>Apple/);
    assert.match(await (await worker.call('/account', get(dupCookie))).text(), /登入 Starry/, 'the duplicate account is signed out');
    assert.equal(await worker.db.prepare('SELECT COUNT(*) AS n FROM users WHERE user_id = ?').bind(dupId).first('n'), 0);
    assert.equal(await worker.db.prepare('SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ?').bind(mainId).first('n'), 1, 'its support ticket moved over');
    const again = pageNonce(await (await worker.call('/account')).text());
    const appleAgain = await signJwt(keys.apple, idTokenClaims('apple', { sub: 'merge-apple', nonce: again, aud: WEB_APPLE_AUDIENCE }));
    assert.equal((await worker.call('/account/session', jsonPost({ provider: 'apple', id_token: appleAgain, nonce: again }))).status, 200);
    assert.equal((await worker.db.prepare("SELECT user_id FROM auth_identities WHERE provider = 'apple' AND subject = 'merge-apple'").first()).user_id, mainId, 'Apple now signs in to the merged account');
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
