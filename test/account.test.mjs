import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authBindings, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const authed = (token, init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });

describe('account lifecycle API', () => {
  let worker;
  let keys;

  before(async () => {
    keys = await authBindings();
    worker = await startWorker({ bindings: keys.bindings });
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  async function nonce() {
    return (await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json()).nonce;
  }

  async function providerBody(provider, sub, extra = {}) {
    const n = await nonce();
    return { app_id: 'echo', id_token: await signJwt(keys[provider], idTokenClaims(provider, { sub, nonce: n })), nonce: n, ...extra };
  }

  async function signIn(provider, sub) {
    const res = await worker.call(`/v1/auth/${provider}`, json(await providerBody(provider, sub)));
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
  }

  test('deletion removes the account at once and for good; the member number is never reused', async () => {
    const first = await signIn('google', 'delete-me');
    const row = await worker.db.prepare('SELECT user_id, member_no FROM users WHERE user_id = (SELECT user_id FROM auth_identities WHERE subject = ?)').bind('delete-me').first();
    assert.match(row.member_no, /^\d{1,4}-\d{7}$/);
    assert.equal((await worker.call('/v1/me/deletion', authed(first.access_token, json({})))).status, 400);
    const res = await worker.call('/v1/me/deletion', authed(first.access_token, json({ confirm: true })));
    assert.equal(res.status, 202);
    assert.equal((await res.json()).status, 'deleted');
    assert.equal(await worker.db.prepare('SELECT COUNT(*) AS n FROM users WHERE user_id = ?').bind(row.user_id).first('n'), 0, 'the member is gone immediately');
    assert.equal(await worker.db.prepare('SELECT COUNT(*) AS n FROM retired_member_numbers WHERE member_no = ?').bind(row.member_no).first('n'), 1, 'the number is retired');
    assert.equal((await worker.call('/v1/me', authed(first.access_token))).status, 401, 'old sessions end immediately');
    assert.equal((await worker.call('/v1/auth/refresh', json({ refresh_token: first.refresh_token }))).status, 401);

    const again = await signIn('google', 'delete-me');
    assert.equal(again.user.status, 'active');
    const fresh = await worker.db.prepare('SELECT user_id, member_no FROM users WHERE user_id = (SELECT user_id FROM auth_identities WHERE subject = ?)').bind('delete-me').first();
    assert.notEqual(fresh.user_id, row.user_id, 'signing in again creates a brand-new member');
    assert.notEqual(fresh.member_no, row.member_no, 'with a different member number');
    assert.equal((await worker.call('/v1/me/deletion', authed(again.access_token, { method: 'DELETE' }))).status, 409, 'nothing to cancel');
  });

  test('a member links Apple to a Google account and can then sign in with either', async () => {
    const google = await signIn('google', 'link-google');
    const link = await worker.call('/v1/me/identities/apple', authed(google.access_token, json(await providerBody('apple', 'link-apple'))));
    assert.equal(link.status, 201, await link.clone().text());
    assert.deepEqual(await link.json(), { provider: 'apple', linked: true });
    const viaApple = await signIn('apple', 'link-apple');
    assert.equal(viaApple.user.user_id, google.user.user_id);
    assert.equal(viaApple.user.is_new, false);
    const me = await (await worker.call('/v1/me', authed(google.access_token))).json();
    assert.deepEqual(me.identities.map((i) => i.provider), ['apple', 'google']);
    const repeat = await worker.call('/v1/me/identities/apple', authed(google.access_token, json(await providerBody('apple', 'link-apple'))));
    assert.equal(repeat.status, 200);
  });

  test('linking refuses identities owned by another member and a second identity per provider', async () => {
    await signIn('apple', 'someone-else');
    const me = await signIn('google', 'link-me');
    const taken = await worker.call('/v1/me/identities/apple', authed(me.access_token, json(await providerBody('apple', 'someone-else'))));
    assert.equal(taken.status, 409);
    assert.equal((await taken.json()).error.code, 'IDENTITY_IN_USE');
    assert.equal((await worker.call('/v1/me/identities/apple', authed(me.access_token, json(await providerBody('apple', 'mine-1'))))).status, 201);
    const second = await worker.call('/v1/me/identities/apple', authed(me.access_token, json(await providerBody('apple', 'mine-2'))));
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'PROVIDER_ALREADY_LINKED');
    const forged = await worker.call('/v1/me/identities/google', authed(me.access_token, json({ ...(await providerBody('google', 'x')), id_token: 'a.b.c' })));
    assert.equal(forged.status, 401);
    assert.equal((await worker.call('/v1/me/identities/apple', json(await providerBody('apple', 'anon')))).status, 401, 'requires sign-in');
  });

  test('an App can merge a separate account made with the other sign-in, after asking the member', async () => {
    const duplicate = await signIn('apple', 'app-merge-apple');
    const main = await signIn('google', 'app-merge-google');
    const ask = await worker.call('/v1/me/identities/apple', authed(main.access_token, json(await providerBody('apple', 'app-merge-apple'))));
    assert.equal(ask.status, 409);
    const conflict = await ask.json();
    assert.equal(conflict.error.code, 'IDENTITY_IN_USE');
    assert.equal(conflict.mergeable, true);
    assert.equal(typeof conflict.other_account_created_at, 'number');
    const merged = await worker.call('/v1/me/identities/apple', authed(main.access_token, json(await providerBody('apple', 'app-merge-apple', { merge_other_account: true }))));
    assert.equal(merged.status, 201, await merged.clone().text());
    assert.deepEqual(await merged.json(), { provider: 'apple', linked: true, merged: true });
    assert.equal((await worker.call('/v1/me', authed(duplicate.access_token))).status, 401, 'the duplicate account is gone');
    const viaApple = await signIn('apple', 'app-merge-apple');
    assert.equal(viaApple.user.user_id, main.user.user_id);
  });

  test('the App reads and edits the restored profile fields (02.01-02.10)', async () => {
    const s = await signIn('google', 'profile-fields-app');
    const patch = (body, version) =>
      worker.call('/v1/me/profile', authed(s.access_token, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${version}"` }, body: JSON.stringify(body) }));
    const res = await patch({ display_name: '回聲', phone: '0912345678', country: 'tw', region: '臺北市', motto: '慢慢來', birthday: '1990-02-28', contact_email: 'Echo@Example.com', visibility: { motto: 'public', birthday: 'public' } }, 1);
    assert.equal(res.status, 200, await res.clone().text());
    const { profile } = await res.json();
    assert.deepEqual([profile.phone, profile.country, profile.contact_email, profile.contact_email_verified], ['+886912345678', 'TW', 'echo@example.com', false]);
    assert.deepEqual([profile.derived.zodiac_name, profile.derived.talent_numbers, profile.derived.life_path_number, profile.derived.lines], ['雙魚座', [31], 4, ['1-2-3']]);
    assert.deepEqual([profile.visibility.birthday, profile.visibility.phone, profile.visibility.display_name], ['public', 'private', 'public']);
    assert.equal(profile.field_updated_at.phone.source, 'member');
    const bad = await patch({ phone: '1' }, 2);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error.message, /^phone:/);
    const me = await (await worker.call('/v1/me', authed(s.access_token))).json();
    assert.deepEqual([me.public_profile.display_name, me.public_profile.birthday_month_day, me.public_profile.motto, me.public_profile.phone, me.public_profile.contact_email], ['回聲', '02-28', '慢慢來', null, null]);
    const suggestion = await worker.call('/v1/me/motto-suggestion?current=' + encodeURIComponent('慢慢來'), authed(s.access_token));
    assert.equal(suggestion.status, 200);
    assert.notEqual((await suggestion.json()).motto, '慢慢來');
    assert.equal((await worker.call('/v1/me/contact-email/verification', authed(s.access_token, { method: 'POST' }))).status, 503, 'no email binding in tests');
  });

  test('avatars upload to R2 and are served only through a signed URL', async () => {
    const session = await signIn('google', 'avatar-user');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
    const put = (body, type = 'image/png') => worker.call('/v1/me/avatar', authed(session.access_token, { method: 'PUT', headers: { 'content-type': type }, body }));
    assert.equal((await put(new TextEncoder().encode('<svg/>'), 'image/svg+xml')).status, 415);
    const res = await put(png);
    assert.equal(res.status, 200, await res.clone().text());
    const { profile } = await res.json();
    assert.match(profile.avatar_url, /^\/v1\/avatars\/[0-9a-f-]+\/[0-9a-f-]+\.png\?exp=\d+&sig=/);
    const image = await worker.call(profile.avatar_url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
    assert.equal((await worker.call(profile.avatar_url.replace(/sig=.*/, 'sig=AAAA'))).status, 404);
    assert.equal((await worker.call(profile.avatar_url.split('?')[0])).status, 404);
    assert.equal((await worker.call('/v1/me/avatar', authed(session.access_token, { method: 'DELETE' }))).status, 204);
    assert.equal((await worker.call(profile.avatar_url)).status, 404);
    const me = await (await worker.call('/v1/me', authed(session.access_token))).json();
    assert.equal(me.profile.avatar_url, null);
  });

  test('Apple sign-in with an authorization code but no Apple secrets still succeeds and is audited', async () => {
    const res = await worker.call('/v1/auth/apple', json(await providerBody('apple', 'with-code', { authorization_code: 'c0de' })));
    assert.equal(res.status, 200);
    const row = await worker.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'apple.token_exchange' AND result = 'error'").first();
    assert.ok(row.n >= 1);
  });
});
