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

  test('deletion disables the account at once; signing in again allows cancelling', async () => {
    const first = await signIn('google', 'delete-me');
    assert.equal((await worker.call('/v1/me/deletion', authed(first.access_token, json({})))).status, 400);
    const res = await worker.call('/v1/me/deletion', authed(first.access_token, json({ confirm: true })));
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.status, 'pending_deletion');
    assert.ok(body.deletion_purge_at > Date.now() + 6 * 24 * 3600 * 1000);
    assert.equal((await worker.call('/v1/me', authed(first.access_token))).status, 401, 'old sessions end immediately');
    assert.equal((await worker.call('/v1/auth/refresh', json({ refresh_token: first.refresh_token }))).status, 401);

    const again = await signIn('google', 'delete-me');
    assert.equal(again.user.status, 'pending_deletion');
    assert.equal(again.user.deletion_purge_at, body.deletion_purge_at);
    const me = await worker.call('/v1/me', authed(again.access_token));
    assert.equal(me.status, 200);
    assert.equal((await me.json()).deletion_purge_at, body.deletion_purge_at);
    const patch = await worker.call('/v1/me/profile', authed(again.access_token, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': '"1"' }, body: JSON.stringify({ display_name: 'x' }) }));
    assert.equal(patch.status, 403);
    assert.equal((await patch.json()).error.code, 'ACCOUNT_PENDING_DELETION');
    assert.equal((await worker.call('/v1/me/deletion', authed(again.access_token, json({ confirm: true })))).status, 403);

    const cancel = await worker.call('/v1/me/deletion', authed(again.access_token, { method: 'DELETE' }));
    assert.equal(cancel.status, 200);
    assert.deepEqual(await cancel.json(), { status: 'active' });
    assert.equal((await worker.call('/v1/me/deletion', authed(again.access_token, { method: 'DELETE' }))).status, 409);
    const ok = await worker.call('/v1/me/profile', authed(again.access_token, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': '"1"' }, body: JSON.stringify({ display_name: '留下來' }) }));
    assert.equal(ok.status, 200);
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

  test('Apple sign-in with an authorization code but no Apple secrets still succeeds and is audited', async () => {
    const res = await worker.call('/v1/auth/apple', json(await providerBody('apple', 'with-code', { authorization_code: 'c0de' })));
    assert.equal(res.status, 200);
    const row = await worker.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'apple.token_exchange' AND result = 'error'").first();
    assert.ok(row.n >= 1);
  });
});
